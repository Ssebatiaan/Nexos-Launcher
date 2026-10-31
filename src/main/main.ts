// Proceso principal del Nexos Launcher: crea la ventana (sin marco: la barra de titulo la dibuja la interfaz) y hace
// lo que la interfaz no puede hacer sola: instalar, abrir el juego, guardar opciones y cuentas, abrir enlaces.
import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import type { ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Accounts } from "./accounts";
import { launchGame } from "./game";
import { ensureJava, ensureMinecraft, ensureNeoForge, freeSpace, friendlyError, pathsFor, type StepProgress } from "./installer";
import { fetchPack, installedVersion, type Pack, syncPack } from "./pack";
import { currentSkin, LoginCancelled, loginInteractive, uploadSkin } from "./microsoft";
import { Skins } from "./skins";
import { queryStatus } from "./status";
import { checkNow, installAvailable, updateOnStartup, type UpdateState, watchForUpdates } from "./updater";

const DISCORD = "https://discord.gg/C8N5V8ncRM";
/** Lista del modpack (rama "pack" del repo). NEXOS_PACK_URL la cambia para probar (por ejemplo una ruta local). */
const PACK_URL = process.env.NEXOS_PACK_URL ?? "https://raw.githubusercontent.com/Ssebatiaan/Nexos-Launcher/pack/pack.json";
/** Espacio que hace falta para la primera instalacion (Java, Minecraft, NeoForge y el modpack, con margen). */
const NEEDED_BYTES = 3 * 1024 ** 3;

const paths = () => pathsFor(app.getPath("userData"));
const accounts = () => new Accounts(app.getPath("userData"));
const skins = () => new Skins(app.getPath("userData"));

/** Cuenta elegida (las skins son por cuenta). */
function skinAccount(): string {
  const account = accounts().selected();
  if (!account) {
    throw new Error("Primero añade una cuenta (abajo a la izquierda, en la pantalla Jugar).");
  }
  return account.id;
}

/** Lista de skins para la interfaz (con premium = la skin elegida es la oficial de Mojang). */
function skinList() {
  const account = accounts().selected();
  return { ...skins().list(account?.id), premium: account?.type === "microsoft" };
}

/**
 * Cambia algo de las skins y, si la cuenta es premium, sube la elegida a Mojang (skin oficial). Si Mojang la rechaza,
 * se vuelve a la que estaba elegida antes.
 */
async function changeSkin(action: (accountId: string) => unknown | Promise<unknown>) {
  const accountId = skinAccount();
  const account = accounts().selected()!;
  const before = skins().selectedId(accountId);
  await action(accountId);
  if (account.type === "microsoft") {
    const chosen = skins().selectedSkin(accountId);
    if (chosen) {
      try {
        const session = await accounts().minecraftSession(accountId);
        await uploadSkin(session.mcToken, chosen.png, chosen.variant);
      } catch (e) {
        skins().select(accountId, before ?? null);
        throw e;
      }
    }
  }
  return skinList();
}

// ------------------------------------------------------------------ opciones

/** Opciones del launcher (en %APPDATA%/Nexos Launcher/opciones.json). */
interface Options {
  ramMb: number;
  /** Que hace el launcher cuando se abre la ventana del juego. */
  onLaunch: "minimizar" | "ocultar" | "nada";
  /** Tamano de la ventana del juego: "auto" (lo que recuerde el juego), "1280x720"... o "completa". */
  resolution: string;
}

const DEFAULT_OPTIONS: Options = { ramMb: 5120, onLaunch: "minimizar", resolution: "auto" };

function resolutionOf(value: string): { width?: number; height?: number; fullscreen?: boolean } | undefined {
  if (value === "completa") return { fullscreen: true };
  const m = /^(\d{3,4})x(\d{3,4})$/.exec(value);
  return m ? { width: Number(m[1]), height: Number(m[2]) } : undefined;
}

function optionsFile(): string {
  return path.join(app.getPath("userData"), "opciones.json");
}

function loadOptions(): Options {
  try {
    return { ...DEFAULT_OPTIONS, ...JSON.parse(fs.readFileSync(optionsFile(), "utf-8")) };
  } catch {
    return { ...DEFAULT_OPTIONS };
  }
}

function saveOptions(options: Options): void {
  fs.mkdirSync(path.dirname(optionsFile()), { recursive: true });
  fs.writeFileSync(optionsFile(), JSON.stringify(options, null, 2), "utf-8");
}

// ------------------------------------------------------------------ jugar

type StepId = "java" | "minecraft" | "neoforge" | "modpack" | "juego";
type StepState = "pendiente" | "activo" | "hecho" | "error";

interface PlayState {
  steps: Array<{ id: StepId; label: string; state: StepState }>;
  text: string;
  percent: number | null;
  phase: "preparando" | "jugando" | "terminado" | "error";
  error?: string;
  canOpenLog?: boolean;
  /** "reparar" = Reparar instalacion (revisa todo y no abre el juego). */
  mode: "jugar" | "reparar";
}

let gameProcess: ChildProcess | undefined;
let busy = false;

/** Anota un error en registros/launcher.log (junto a juego.log). */
function logLauncher(where: string, e: unknown): void {
  try {
    fs.mkdirSync(path.dirname(logFile()), { recursive: true });
    fs.appendFileSync(path.join(path.dirname(logFile()), "launcher.log"),
      `${new Date().toISOString()} [${where}] ${e instanceof Error ? e.stack ?? e.message : e}\n`, "utf-8");
  } catch {
    // sin registro no se puede hacer mas
  }
}

// Un error suelto de una descarga no debe sacar la ventana de error de Electron (en ingles): las descargas ya se
// repiten solas. Cualquier otro error se anota y se avisa en espanol.
process.on("uncaughtException", (e) => {
  logLauncher("sin capturar", e);
  if (!/undici|file-transfer|ECONNRESET|socket/i.test(`${e.stack ?? e.message}`)) {
    dialog.showErrorBox("Nexos Launcher", "Ocurrió un error inesperado. Si se repite, avisa en el Discord y manda el "
      + `archivo registros/launcher.log.\n\n${e.message}`);
  }
});

function logFile(): string {
  return path.join(app.getPath("userData"), "registros", "juego.log");
}

/** Lo instalado la ultima vez (para poder jugar sin internet si ya esta todo). */
function lastPack(): Pack | undefined {
  try {
    return JSON.parse(fs.readFileSync(path.join(app.getPath("userData"), "ultimo-pack.json"), "utf-8")) as Pack;
  } catch {
    return undefined;
  }
}

/** Guarda la lista del modpack como la ultima conocida (para jugar sin internet y para el estado al abrir). */
function rememberPack(pack: Pack): void {
  fs.mkdirSync(app.getPath("userData"), { recursive: true });
  fs.writeFileSync(path.join(app.getPath("userData"), "ultimo-pack.json"), JSON.stringify(pack), "utf-8");
}

async function play(win: BrowserWindow, mode: "jugar" | "reparar"): Promise<void> {
  const repair = mode === "reparar";
  const state: PlayState = {
    steps: [
      { id: "java", label: "Java 21", state: "pendiente" },
      { id: "minecraft", label: "Minecraft", state: "pendiente" },
      { id: "neoforge", label: "NeoForge", state: "pendiente" },
      { id: "modpack", label: "Modpack Nexos MC", state: "pendiente" },
      ...(repair ? [] : [{ id: "juego" as StepId, label: "Abrir el juego", state: "pendiente" as StepState }]),
    ],
    text: repair ? "Revisando la instalación…" : "Preparando…",
    percent: null,
    phase: "preparando",
    mode,
  };
  const send = () => !win.isDestroyed() && win.webContents.send("juego:estado", state);
  const step = (id: StepId, s: StepState) => {
    state.steps.find((x) => x.id === id)!.state = s;
    send();
  };
  const progress = (p: StepProgress) => {
    state.text = p.bytesTotal > 0 ? `${p.label}… ${(p.bytesDone / 1e6).toFixed(0)} de ${(p.bytesTotal / 1e6).toFixed(0)} MB` : `${p.label}…`;
    state.percent = p.bytesTotal > 0 ? Math.min(100, (p.bytesDone / p.bytesTotal) * 100) : null;
    send();
  };
  let current: StepId = "java";
  try {
    const account = accounts().selected();
    if (!account && !repair) {
      throw new Error("Añade una cuenta para jugar (pulsa en «Sin cuenta», abajo a la izquierda).");
    }
    // Lista del modpack; sin internet se juega con lo ya instalado
    let pack: Pack;
    let offline = false;
    state.text = "Buscando actualizaciones…";
    send();
    try {
      pack = await fetchPack(PACK_URL);
      rememberPack(pack);
    } catch (e) {
      const known = lastPack();
      if (!known || repair) {
        if (repair) throw new Error("Para reparar la instalación hace falta internet.");
        throw new Error("No hay conexión a internet y el juego aún no está instalado. Conéctate y pulsa JUGAR otra vez.");
      }
      pack = known;
      offline = true;
    }
    state.steps[1].label = `Minecraft ${pack.minecraft}`;
    state.steps[2].label = `NeoForge ${pack.neoforge}`;
    state.steps[3].label = `Modpack Nexos MC ${pack.version}`;
    const p = paths();
    if (!fs.existsSync(path.join(p.minecraft, "versions", `neoforge-${pack.neoforge}`)) && (await freeSpace(p.root)) < NEEDED_BYTES) {
      throw new Error(`No hay espacio suficiente: la instalación necesita unos 3 GB libres en el disco de ${p.root.slice(0, 2)}.`);
    }

    current = "java";
    step("java", "activo");
    const java = await ensureJava(p, pack.java, progress, repair);
    step("java", "hecho");

    current = "minecraft";
    step("minecraft", "activo");
    let versionId = `neoforge-${pack.neoforge}`;
    if (offline) {
      state.text = "Sin internet: se usa lo que ya está instalado.";
      step("minecraft", "hecho");
      step("neoforge", "hecho");
    } else {
      await ensureMinecraft(p, pack.minecraft, progress);
      step("minecraft", "hecho");
      current = "neoforge";
      step("neoforge", "activo");
      versionId = await ensureNeoForge(p, pack.neoforge, java, progress);
      step("neoforge", "hecho");
    }

    current = "modpack";
    step("modpack", "activo");
    if (!offline) {
      await syncPack(pack, p.game, (sp) => {
        if (sp.phase === "comprobando") {
          state.text = `Comprobando el modpack… ${sp.done}/${sp.total}`;
          state.percent = (sp.done / Math.max(1, sp.total)) * 100;
        } else if (sp.phase === "descargando") {
          state.text = `Descargando el modpack… ${sp.done}/${sp.total} archivos · ${(sp.bytesDone / 1e6).toFixed(0)} de ${(sp.bytesTotal / 1e6).toFixed(0)} MB`;
          state.percent = (sp.bytesDone / Math.max(1, sp.bytesTotal)) * 100;
        }
        send();
      }, { full: repair });
    }
    step("modpack", "hecho");
    if (repair) {
      state.phase = "terminado";
      state.text = "Instalación revisada: todo está bien. Ya puedes jugar.";
      state.percent = 100;
      send();
      return;
    }

    current = "juego";
    step("juego", "activo");
    state.text = `Abriendo Minecraft como ${account!.name}… (la primera vez tarda un poco)`;
    state.percent = null;
    send();
    const options = loadOptions();
    // La skin elegida en el launcher: Nexus Protect la manda al entrar al servidor (las premium usan la oficial)
    skins().writeToGame(p.game, account!.id, account!.type === "microsoft");
    const premium = account!.type === "microsoft" ? await accounts().minecraftSession(account!.id) : undefined;
    gameProcess = await launchGame({
      paths: p, versionId, java, account: account!, ramMb: options.ramMb, resolution: resolutionOf(options.resolution),
      premium: premium && { accessToken: premium.mcToken, xuid: premium.xuid },
      server: process.env.NEXOS_PRUEBA_ENTRAR === "1" ? pack.server : undefined,
      logFile: logFile(), launcherVersion: app.getVersion(),
    }, {
      onWindowReady: () => {
        step("juego", "hecho");
        state.phase = "jugando";
        state.text = "Jugando en Nexos MC. ¡Diviértete!";
        send();
        if (win.isDestroyed()) return;
        if (options.onLaunch === "minimizar") win.minimize();
        if (options.onLaunch === "ocultar") win.hide();
      },
      onExit: ({ code, crashReportLocation }) => {
        gameProcess = undefined;
        if (!win.isDestroyed()) {
          win.show();
          win.restore();
          win.focus();
        }
        if (code === 0 || code === null) {
          state.phase = "terminado";
          state.text = "El juego se cerró. ¡Hasta la próxima!";
        } else {
          state.phase = "error";
          step("juego", "error");
          state.error = "El juego se cerró con un error" + (crashReportLocation ? " (hay un informe de error)." : ".")
            + " Pulsa «Ver registro» y mándalo en el Discord si se repite.";
          state.canOpenLog = true;
        }
        send();
      },
      onError: (e) => {
        gameProcess = undefined;
        state.phase = "error";
        step("juego", "error");
        state.error = "No se pudo abrir el juego: " + e.message;
        state.canOpenLog = true;
        send();
      },
    });
    state.phase = "jugando";
    send();
  } catch (e) {
    const err = friendlyError(e);
    state.phase = "error";
    state.error = err.message;
    state.steps.find((x) => x.id === current)!.state = "error";
    state.canOpenLog = current === "juego";
    logLauncher(current, e);
    send();
  }
}

// ------------------------------------------------------------------ estado al abrir

/** Datos para la pantalla Jugar: modpack (nuevo o instalado) y novedades. Sin internet, lo ultimo conocido. */
async function launcherInfo(): Promise<{ version?: string; installed?: string; news: Pack["news"]; online: boolean }> {
  let pack: Pack | undefined;
  let online = true;
  try {
    pack = await fetchPack(PACK_URL);
    rememberPack(pack);
  } catch {
    pack = lastPack();
    online = false;
  }
  return { version: pack?.version, installed: installedVersion(paths().game), news: pack?.news ?? [], online };
}

async function serverStatus() {
  const server = lastPack()?.server;
  if (!server) return { online: false };
  return queryStatus(server.host, server.port);
}

// ------------------------------------------------------------------ ventanas

const ICON = path.join(__dirname, "..", "renderer", "assets", "icon.png");
const PRELOAD = path.join(__dirname, "preload.js");

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1100,
    height: 680,
    minWidth: 960,
    minHeight: 600,
    frame: false,
    backgroundColor: "#0b0614",
    title: "Nexos Launcher",
    icon: ICON,
    show: false,
    webPreferences: { preload: PRELOAD, contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.loadFile(path.join(__dirname, "..", "renderer", "index.html"));
  return win;
}

/** Ventanita del arranque (como la de Steam): "Buscando actualizaciones…" y, si hay, la descarga. */
function createSplash(): BrowserWindow {
  const splash = new BrowserWindow({
    width: 360,
    height: 420,
    frame: false,
    resizable: false,
    backgroundColor: "#0b0614",
    title: "Nexos Launcher",
    icon: ICON,
    show: false,
    webPreferences: { preload: PRELOAD, contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  splash.loadFile(path.join(__dirname, "..", "renderer", "splash.html"));
  splash.once("ready-to-show", () => splash.show());
  return splash;
}

/** --captura=archivo.png: abre, espera a que pinte, guarda una imagen de la ventana y se cierra (para revisar el diseno). */
function captureArg(): string | undefined {
  const arg = process.argv.find((a) => a.startsWith("--captura="));
  return arg?.substring("--captura=".length);
}

function sendAll(channel: string, data: unknown): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(channel, data);
  }
}

function registerIpc(): void {
  ipcMain.on("ventana:minimizar", (e) => BrowserWindow.fromWebContents(e.sender)?.minimize());
  ipcMain.on("ventana:cerrar", (e) => BrowserWindow.fromWebContents(e.sender)?.close());
  ipcMain.on("abrir:discord", () => shell.openExternal(DISCORD));
  ipcMain.on("abrir:registro", () => {
    const file = fs.existsSync(logFile()) ? logFile() : path.join(path.dirname(logFile()), "launcher.log");
    shell.openPath(file);
  });
  ipcMain.on("abrir:carpeta", () => {
    fs.mkdirSync(paths().game, { recursive: true });
    shell.openPath(paths().game);
  });
  ipcMain.handle("opciones:leer", () => loadOptions());
  ipcMain.handle("opciones:guardar", (_e, options: Partial<Options>) => saveOptions({ ...loadOptions(), ...options }));
  ipcMain.handle("app:version", () => app.getVersion());
  ipcMain.handle("app:info", () => launcherInfo());
  ipcMain.handle("servidor:estado", () => serverStatus());
  ipcMain.handle("sistema:info", () => ({ totalMb: Math.floor(os.totalmem() / 1024 / 1024) }));
  ipcMain.handle("cuentas:listar", () => accounts().list());
  ipcMain.handle("cuentas:anadir", (_e, name: string) => accounts().addOffline(name));
  ipcMain.handle("cuentas:microsoft", async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)!;
    try {
      const session = await loginInteractive(win);
      const account = accounts().addMicrosoft(session);
      // Su skin oficial entra en el historial y queda elegida (si no la tiene ya)
      try {
        const skin = await currentSkin(session.mcToken);
        if (skin) skins().importPng(account.id, skin.png, "Skin oficial", skin.variant);
      } catch (err) {
        logLauncher("skin oficial", err);
      }
      return account;
    } catch (err) {
      if (err instanceof LoginCancelled) return null;
      logLauncher("microsoft", err);
      throw err;
    }
  });
  ipcMain.handle("cuentas:elegir", (_e, id: string) => accounts().select(id));
  ipcMain.handle("cuentas:borrar", (_e, id: string) => accounts().remove(id));
  ipcMain.handle("skins:listar", () => skinList());
  ipcMain.handle("skins:subir", async (e, variant: "classic" | "slim") => {
    const account = skinAccount();
    const win = BrowserWindow.fromWebContents(e.sender)!;
    const pick = await dialog.showOpenDialog(win, {
      title: "Elige tu skin (PNG de 64×64)",
      filters: [{ name: "Skin de Minecraft", extensions: ["png"] }],
      properties: ["openFile"],
    });
    if (pick.canceled || !pick.filePaths[0]) {
      return skinList();
    }
    return changeSkin((id) => skins().addPng(id, pick.filePaths[0], variant));
  });
  ipcMain.handle("skins:premium", (_e, name: string) => changeSkin((id) => skins().addPremium(id, name.trim())));
  ipcMain.handle("skins:elegir", (_e, id: string | null) => changeSkin((account) => skins().select(account, id)));
  ipcMain.handle("skins:variante", (_e, id: string, variant: "classic" | "slim") => changeSkin(() => skins().setVariant(id, variant)));
  ipcMain.handle("skins:borrar", (_e, id: string) => {
    skins().remove(id);
    return skinList();
  });
  ipcMain.handle("actualizar:buscar", async () => {
    const s = await checkNow();
    if (s.phase === "disponible") sendAll("actualizar:estado", s);
    return s;
  });
  ipcMain.handle("actualizar:instalar", () =>
    installAvailable((s) => sendAll("actualizar:estado", s)).catch((e) => logLauncher("actualizar", e)));
  const run = async (e: Electron.IpcMainInvokeEvent, mode: "jugar" | "reparar") => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win || busy || gameProcess) {
      return false;
    }
    busy = true;
    try {
      await play(win, mode);
    } finally {
      busy = false;
    }
    return true;
  };
  ipcMain.handle("juego:jugar", (e) => run(e, "jugar"));
  ipcMain.handle("juego:reparar", (e) => run(e, "reparar"));
}

function openMain(splash?: BrowserWindow): BrowserWindow {
  const win = createWindow();
  win.once("ready-to-show", () => {
    win.show();
    splash?.destroy();
  });
  win.on("close", () => {
    // Cerrar el launcher no cierra el juego: sigue abierto por su cuenta
    gameProcess?.unref();
  });
  watchForUpdates((s) => sendAll("actualizar:estado", s), (e) => logLauncher("actualizar", e));
  return win;
}

// Una sola ventana: si se abre otra vez, se trae la que ya esta (tambien si estaba oculta mientras se juega)
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      win.show();
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(async () => {
    registerIpc();
    const capture = captureArg();
    if (capture?.includes("splash")) {
      // Captura de la ventana del arranque con una descarga a medias (para revisar el diseno)
      const splash = createSplash();
      splash.webContents.once("did-finish-load", () => {
        splash.webContents.send("actualizar:estado", { phase: "descargando", version: "0.2.1", percent: 42 } satisfies UpdateState);
        setTimeout(async () => {
          fs.writeFileSync(capture, (await splash.webContents.capturePage()).toPNG());
          app.quit();
        }, 1200);
      });
      return;
    }

    // Como Steam: antes de nada, buscar e instalar la version nueva del launcher (solo en el launcher instalado)
    let splash: BrowserWindow | undefined;
    if (app.isPackaged || process.env.NEXOS_PRUEBA_UPDATER === "1") {
      const s = createSplash();
      splash = s;
      await new Promise<void>((ok) => s.webContents.once("did-finish-load", () => ok()));
      const installing = await updateOnStartup((u) => !s.isDestroyed() && s.webContents.send("actualizar:estado", u),
        (e) => logLauncher("actualizar", e));
      if (installing) {
        return; // se cierra y se abre la version nueva
      }
    }

    const win = openMain(splash);
    if (capture) {
      // NEXOS_PRUEBA_JUGAR=1 pulsa JUGAR (NEXOS_PRUEBA_BOTON=btn-repair, Reparar) y espera a que acabe antes de la captura.
      const button = process.env.NEXOS_PRUEBA_BOTON ?? (process.env.NEXOS_PRUEBA_JUGAR === "1" ? "play-btn" : undefined);
      win.webContents.once("did-finish-load", () => {
        setTimeout(async () => {
          if (process.env.NEXOS_VISTA) {
            // Para revisar otra pantalla en la captura (por ejemplo NEXOS_VISTA=opciones)
            await win.webContents.executeJavaScript(`(document.querySelector('[data-view="${process.env.NEXOS_VISTA}"]') || document.getElementById('${process.env.NEXOS_VISTA}'))?.click()`);
            await new Promise((ok) => setTimeout(ok, 400));
          }
          if (button) {
            await win.webContents.executeJavaScript(`new Promise((ok) => {
              document.getElementById("${button}").click();
              const t = setInterval(() => { const s = window.__estado; if (s && s.phase !== "preparando") { clearInterval(t); ok(); } }, 500);
            })`);
          }
          const image = await win.webContents.capturePage();
          fs.writeFileSync(capture, image.toPNG());
          if (!gameProcess) app.quit();
        }, 2500);
      });
    }
  });

  app.on("window-all-closed", () => app.quit());
}
