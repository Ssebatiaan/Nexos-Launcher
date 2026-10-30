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
import { fetchPack, type Pack, syncPack } from "./pack";

const DISCORD = "https://discord.gg/C8N5V8ncRM";
/** Lista del modpack (rama "pack" del repo). NEXOS_PACK_URL la cambia para probar (por ejemplo una ruta local). */
const PACK_URL = process.env.NEXOS_PACK_URL ?? "https://raw.githubusercontent.com/Ssebatiaan/Nexos-Launcher/pack/pack.json";
/** Espacio que hace falta para la primera instalacion (Java, Minecraft, NeoForge y el modpack, con margen). */
const NEEDED_BYTES = 3 * 1024 ** 3;

const paths = () => pathsFor(app.getPath("userData"));
const accounts = () => new Accounts(app.getPath("userData"));

// ------------------------------------------------------------------ opciones

/** Opciones del launcher (en %APPDATA%/Nexos Launcher/opciones.json). */
interface Options {
  ramMb: number;
}

const DEFAULT_OPTIONS: Options = { ramMb: 5120 };

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

async function play(win: BrowserWindow): Promise<void> {
  const state: PlayState = {
    steps: [
      { id: "java", label: "Java 21", state: "pendiente" },
      { id: "minecraft", label: "Minecraft", state: "pendiente" },
      { id: "neoforge", label: "NeoForge", state: "pendiente" },
      { id: "modpack", label: "Modpack Nexos MC", state: "pendiente" },
      { id: "juego", label: "Abrir el juego", state: "pendiente" },
    ],
    text: "Preparando…",
    percent: null,
    phase: "preparando",
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
    if (!account) {
      throw new Error("Añade una cuenta para jugar (pulsa en «Sin cuenta», abajo a la izquierda).");
    }
    // Lista del modpack; sin internet se juega con lo ya instalado
    let pack: Pack;
    let offline = false;
    state.text = "Buscando actualizaciones…";
    send();
    try {
      pack = await fetchPack(PACK_URL);
      fs.writeFileSync(path.join(app.getPath("userData"), "ultimo-pack.json"), JSON.stringify(pack), "utf-8");
    } catch (e) {
      const known = lastPack();
      if (!known) {
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
    const java = await ensureJava(p, pack.java, progress);
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
      });
    }
    step("modpack", "hecho");

    current = "juego";
    step("juego", "activo");
    state.text = `Abriendo Minecraft como ${account.name}… (la primera vez tarda un poco)`;
    state.percent = null;
    send();
    const ramMb = loadOptions().ramMb;
    gameProcess = await launchGame({
      paths: p, versionId, java, account, ramMb, logFile: logFile(), launcherVersion: app.getVersion(),
    }, {
      onWindowReady: () => {
        step("juego", "hecho");
        state.phase = "jugando";
        state.text = "Jugando en Nexos MC. ¡Diviértete!";
        send();
        if (!win.isDestroyed()) win.minimize();
      },
      onExit: ({ code, crashReportLocation }) => {
        gameProcess = undefined;
        if (!win.isDestroyed()) {
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

// ------------------------------------------------------------------ ventana

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1100,
    height: 680,
    minWidth: 960,
    minHeight: 600,
    frame: false,
    backgroundColor: "#0b0614",
    title: "Nexos Launcher",
    icon: path.join(__dirname, "..", "renderer", "assets", "logo.png"),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.loadFile(path.join(__dirname, "..", "renderer", "index.html"));
  win.once("ready-to-show", () => win.show());
  return win;
}

/** --captura=archivo.png: abre, espera a que pinte, guarda una imagen de la ventana y se cierra (para revisar el diseno). */
function captureArg(): string | undefined {
  const arg = process.argv.find((a) => a.startsWith("--captura="));
  return arg?.substring("--captura=".length);
}

// Una sola ventana: si se abre otra vez, se trae la que ya esta
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    ipcMain.on("ventana:minimizar", (e) => BrowserWindow.fromWebContents(e.sender)?.minimize());
    ipcMain.on("ventana:cerrar", (e) => BrowserWindow.fromWebContents(e.sender)?.close());
    ipcMain.on("abrir:discord", () => shell.openExternal(DISCORD));
    ipcMain.on("abrir:registro", () => {
      const file = fs.existsSync(logFile()) ? logFile() : path.join(path.dirname(logFile()), "launcher.log");
      shell.openPath(file);
    });
    ipcMain.handle("opciones:leer", () => loadOptions());
    ipcMain.handle("opciones:guardar", (_e, options: Options) => saveOptions({ ...loadOptions(), ...options }));
    ipcMain.handle("app:version", () => app.getVersion());
    ipcMain.handle("sistema:info", () => ({ totalMb: Math.floor(os.totalmem() / 1024 / 1024) }));
    ipcMain.handle("cuentas:listar", () => accounts().list());
    ipcMain.handle("cuentas:anadir", (_e, name: string) => accounts().addOffline(name));
    ipcMain.handle("cuentas:elegir", (_e, id: string) => accounts().select(id));
    ipcMain.handle("cuentas:borrar", (_e, id: string) => accounts().remove(id));
    ipcMain.handle("juego:jugar", async (e) => {
      const win = BrowserWindow.fromWebContents(e.sender);
      if (!win || busy || gameProcess) {
        return false;
      }
      busy = true;
      try {
        await play(win);
      } finally {
        busy = false;
      }
      return true;
    });

    const win = createWindow();
    win.on("close", () => {
      // Cerrar el launcher no cierra el juego: sigue abierto por su cuenta
      gameProcess?.unref();
    });
    const capture = captureArg();
    if (capture) {
      // NEXOS_PRUEBA_JUGAR=1: pulsa JUGAR y espera a que acabe la preparacion antes de la captura (pruebas).
      const pressPlay = process.env.NEXOS_PRUEBA_JUGAR === "1";
      win.webContents.once("did-finish-load", () => {
        setTimeout(async () => {
          if (pressPlay) {
            await win.webContents.executeJavaScript(`new Promise((ok) => {
              document.getElementById("play-btn").click();
              const t = setInterval(() => { const s = window.__estado; if (s && s.phase !== "preparando") { clearInterval(t); ok(); } }, 500);
            })`);
          }
          const image = await win.webContents.capturePage();
          fs.writeFileSync(capture, image.toPNG());
          if (!gameProcess) app.quit();
        }, 1500);
      });
    }
  });

  app.on("window-all-closed", () => app.quit());
}
