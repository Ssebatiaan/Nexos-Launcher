// Actualizaciones del propio launcher (electron-updater con las Releases de GitHub del repo).
// - Al abrir (como Steam): se busca version nueva; si la hay se descarga y se instala sola antes de seguir.
// - Con el launcher abierto: cada 30 min se mira; si hay una nueva se avisa ("Actualización lista") y el jugador decide
//   cuando: al pulsar se descarga, se instala y el launcher se reinicia.
// Solo funciona en el launcher instalado (no con npm start).
import { app } from "electron";
import { autoUpdater, type ProgressInfo } from "electron-updater";

export interface UpdateState {
  phase: "buscando" | "al-dia" | "disponible" | "descargando" | "instalando" | "error";
  version?: string;
  percent?: number;
  error?: string;
}

const CHECK_EVERY_MS = 30 * 60 * 1000;
const STARTUP_TIMEOUT_MS = 10_000;

autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = false;
autoUpdater.logger = null;

/** Hay actualizaciones en esta forma de ejecutar el launcher? (NEXOS_PRUEBA_UPDATER=1 las prueba con npm start). */
export function updatesSupported(): boolean {
  if (!app.isPackaged && process.env.NEXOS_PRUEBA_UPDATER === "1") {
    autoUpdater.forceDevUpdateConfig = true;
    return true;
  }
  return app.isPackaged;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, fail) => setTimeout(() => fail(new Error("tiempo agotado")), ms))]);
}

let available: string | undefined;
let downloading = false;

/**
 * Comprobacion al abrir. Devuelve true si se esta instalando una version nueva (el launcher se cerrara y se volvera a
 * abrir solo); false para seguir (al dia, sin internet o cualquier fallo: nunca impide jugar).
 */
export async function updateOnStartup(send: (s: UpdateState) => void, log: (e: unknown) => void): Promise<boolean> {
  if (!updatesSupported()) return false;
  send({ phase: "buscando" });
  try {
    const result = await withTimeout(autoUpdater.checkForUpdates(), STARTUP_TIMEOUT_MS);
    if (!result?.isUpdateAvailable) {
      send({ phase: "al-dia" });
      return false;
    }
    await download(result.updateInfo.version, send);
    return true;
  } catch (e) {
    log(e);
    return false;
  }
}

/** Mira cada 30 min si hay version nueva y avisa (no descarga nada hasta que el jugador lo pide). */
export function watchForUpdates(send: (s: UpdateState) => void, log: (e: unknown) => void): void {
  if (!updatesSupported()) return;
  const check = async () => {
    if (downloading) return;
    try {
      const result = await autoUpdater.checkForUpdates();
      if (result?.isUpdateAvailable) {
        available = result.updateInfo.version;
        send({ phase: "disponible", version: available });
      }
    } catch (e) {
      log(e);
    }
  };
  setInterval(check, CHECK_EVERY_MS);
}

/** "Buscar actualizaciones" de Opciones: dice si hay una nueva (y la deja anunciada) o si ya esta al dia. */
export async function checkNow(): Promise<UpdateState> {
  if (!updatesSupported()) {
    return { phase: "error", error: "Las actualizaciones solo funcionan en el launcher instalado." };
  }
  try {
    const result = await withTimeout(autoUpdater.checkForUpdates(), 15_000);
    if (result?.isUpdateAvailable) {
      available = result.updateInfo.version;
      return { phase: "disponible", version: available };
    }
    return { phase: "al-dia", version: app.getVersion() };
  } catch {
    return { phase: "error", error: "No se pudo comprobar (¿hay internet?)." };
  }
}

/** El jugador pulso "Actualizar": descarga e instala la version anunciada y reinicia. */
export async function installAvailable(send: (s: UpdateState) => void): Promise<void> {
  if (!available) {
    const result = await autoUpdater.checkForUpdates();
    if (!result?.isUpdateAvailable) {
      send({ phase: "al-dia" });
      return;
    }
    available = result.updateInfo.version;
  }
  try {
    await download(available, send);
  } catch (e) {
    send({ phase: "error", version: available, error: "No se pudo descargar la actualización. Prueba otra vez en un rato." });
    throw e;
  }
}

async function download(version: string, send: (s: UpdateState) => void): Promise<void> {
  if (downloading) return;
  downloading = true;
  const onProgress = (p: ProgressInfo) => send({ phase: "descargando", version, percent: Math.round(p.percent) });
  autoUpdater.on("download-progress", onProgress);
  try {
    send({ phase: "descargando", version, percent: 0 });
    await autoUpdater.downloadUpdate();
    send({ phase: "instalando", version });
    // Instalacion silenciosa y se vuelve a abrir el launcher ya actualizado
    setTimeout(() => autoUpdater.quitAndInstall(true, true), 800);
  } finally {
    autoUpdater.off("download-progress", onProgress);
    downloading = false;
  }
}
