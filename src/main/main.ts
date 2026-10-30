// Proceso principal del Nexos Launcher: crea la ventana (sin marco: la barra de titulo la dibuja la interfaz) y
// atiende lo que la interfaz no puede hacer sola (minimizar, cerrar, abrir enlaces, guardar opciones).
import { app, BrowserWindow, ipcMain, shell } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import { fetchPack, syncPack } from "./pack";

const DISCORD = "https://discord.gg/C8N5V8ncRM";
/** Lista del modpack (rama "pack" del repo). NEXOS_PACK_URL la cambia para probar (por ejemplo una ruta local). */
const PACK_URL = process.env.NEXOS_PACK_URL ?? "https://raw.githubusercontent.com/Ssebatiaan/Nexos-Launcher/pack/pack.json";

/** Carpeta del juego: %APPDATA%/Nexos Launcher/juego. */
function gameDir(): string {
  return path.join(app.getPath("userData"), "juego");
}

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

app.whenReady().then(() => {
  ipcMain.on("ventana:minimizar", (e) => BrowserWindow.fromWebContents(e.sender)?.minimize());
  ipcMain.on("ventana:cerrar", (e) => BrowserWindow.fromWebContents(e.sender)?.close());
  ipcMain.on("abrir:discord", () => shell.openExternal(DISCORD));
  ipcMain.handle("opciones:leer", () => loadOptions());
  ipcMain.handle("opciones:guardar", (_e, options: Options) => saveOptions({ ...loadOptions(), ...options }));
  ipcMain.handle("app:version", () => app.getVersion());
  // Comprueba y actualiza el modpack; el progreso se manda a la ventana con "pack:progreso".
  ipcMain.handle("pack:sincronizar", async (e) => {
    const pack = await fetchPack(PACK_URL);
    const result = await syncPack(pack, gameDir(), (p) => e.sender.send("pack:progreso", p));
    return { ...result, minecraft: pack.minecraft, neoforge: pack.neoforge };
  });

  const win = createWindow();
  const capture = captureArg();
  if (capture) {
    // NEXOS_PRUEBA_JUGAR=1: pulsa JUGAR y espera a que termine antes de la captura (para probar sin tocar nada).
    const pressPlay = process.env.NEXOS_PRUEBA_JUGAR === "1";
    win.webContents.once("did-finish-load", () => {
      setTimeout(async () => {
        if (pressPlay) {
          await win.webContents.executeJavaScript(`new Promise((ok) => {
            const btn = document.getElementById("play-btn");
            btn.click();
            const t = setInterval(() => { if (!btn.disabled) { clearInterval(t); ok(); } }, 300);
          })`);
        }
        const image = await win.webContents.capturePage();
        fs.writeFileSync(capture, image.toPNG());
        app.quit();
      }, 1500);
    });
  }
});

app.on("window-all-closed", () => app.quit());
