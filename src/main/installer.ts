// Instala lo que falte para jugar: Java 21 (el oficial de Mojang), Minecraft (juego, librerias y recursos) y NeoForge.
// Usa @xmcl/installer 6.1.2 (fijada: las 6.3.x se publicaron con fallos de empaquetado). Cada archivo lleva su huella
// y solo se baja lo que falta o esta danado, asi que comprobar una instalacion completa es rapido.
import { MinecraftFolder, Version } from "@xmcl/core";
import {
  DEFAULT_RUNTIME_ALL_URL,
  getVersionList,
  installDependenciesTask,
  installJavaRuntimeWithJsonTask,
  installNeoForgedTask,
  installTask,
  type JavaRuntimeTarget,
  resolveJava,
} from "@xmcl/installer";
import type { Task } from "@xmcl/task";
import * as fs from "node:fs";
import * as path from "node:path";
import { Agent, interceptors } from "undici";

/**
 * Conexiones para las descargas: sin limite, miles de recursos abrian miles de conexiones a la vez a los servidores de
 * Mojang y muchas no llegaban a conectar ("Connect Timeout"). 16 a la vez y 30 s para conectar.
 */
const dispatcher = new Agent({ connections: 16, connect: { timeout: 30_000 }, headersTimeout: 60_000, bodyTimeout: 60_000 })
  .compose(interceptors.redirect({ maxRedirections: 5 })); // @xmcl pide seguir redirecciones (en undici 7 va aparte)
const DOWNLOAD = { dispatcher, assetsDownloadConcurrency: 16, librariesDownloadConcurrency: 8 };
/** Pasadas como mucho: cada una baja solo lo que falta (un corte de internet no obliga a empezar de cero). */
const PASSES = 4;

export interface Paths {
  /** Carpeta del launcher (%APPDATA%/Nexos Launcher). */
  root: string;
  /** versions, libraries y assets. */
  minecraft: string;
  /** Carpeta de la partida: mods, config, saves, options.txt. */
  game: string;
  /** Java de Mojang. */
  java: string;
}

/** Un paso con su progreso en bytes (si se sabe). */
export interface StepProgress {
  label: string;
  bytesDone: number;
  bytesTotal: number;
}

type OnProgress = (p: StepProgress) => void;

export function pathsFor(root: string): Paths {
  return {
    root,
    minecraft: path.join(root, "minecraft"),
    game: path.join(root, "juego"),
    java: path.join(root, "java"),
  };
}

/** Repite una instalacion si falla alguna descarga (cada pasada solo baja lo que falta). */
async function withRetries<T>(job: (pass: number) => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let pass = 1; pass <= PASSES; pass++) {
    try {
      return await job(pass);
    } catch (e) {
      lastError = e;
      await new Promise((ok) => setTimeout(ok, 1500 * pass));
    }
  }
  throw friendlyError(lastError);
}

/** Convierte los errores de descarga en un mensaje entendible. */
export function friendlyError(e: unknown): Error {
  const inner: unknown[] = (e as { errors?: unknown[] }).errors ?? [e];
  const text = inner.map((x) => (x instanceof Error ? `${x.name} ${x.message} ${(x as { code?: string }).code ?? ""}` : String(x))).join(" ");
  if (/ConnectTimeout|ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|fetch failed|UND_ERR/i.test(text)) {
    return new Error("No hay conexión con los servidores de descarga (Mojang/NeoForge). Revisa tu internet y pulsa JUGAR otra vez: seguirá donde se quedó.");
  }
  if (/ENOSPC/i.test(text)) {
    return new Error("El disco está lleno. Libera espacio y pulsa JUGAR otra vez.");
  }
  if (/EPERM|EACCES|EBUSY/i.test(text)) {
    return new Error("Windows no deja escribir algunos archivos (¿un antivirus o el juego abierto?). Cierra el juego y pulsa JUGAR otra vez.");
  }
  const first = inner[0];
  return first instanceof Error ? first : new Error(String(first));
}

/** Ejecuta una tarea de @xmcl contando bytes para la barra. */
async function run<T>(label: string, task: Task<T>, onProgress: OnProgress): Promise<T> {
  let last = 0;
  onProgress({ label, bytesDone: 0, bytesTotal: 0 });
  const result = await task.startAndWait({
    onUpdate() {
      const now = Date.now();
      if (now - last > 200) {
        last = now;
        onProgress({ label, bytesDone: task.progress, bytesTotal: task.total });
      }
    },
  });
  onProgress({ label, bytesDone: task.total, bytesTotal: task.total });
  return result;
}

// ------------------------------------------------------------------ Java

/** Ruta del java.exe de Mojang (se instala si falta o no es la version pedida). */
/** repair = se vuelve a instalar aunque parezca bien (Reparar instalacion; son ~100 MB). */
export async function ensureJava(paths: Paths, major: number, onProgress: OnProgress, repair = false): Promise<string> {
  const exe = path.join(paths.java, "bin", process.platform === "win32" ? "java.exe" : "java");
  if (!repair && fs.existsSync(exe)) {
    const info = await resolveJava(exe).catch(() => undefined);
    if (info && info.majorVersion >= major) {
      return exe;
    }
  }
  const target = await officialJavaTarget(major);
  fs.rmSync(paths.java, { recursive: true, force: true });
  await withRetries(() => run(`Instalando Java ${major}`, installJavaRuntimeWithJsonTask({ target, destination: paths.java, dispatcher }), onProgress));
  const info = await resolveJava(exe).catch(() => undefined);
  if (!info) {
    throw new Error("Java se descargó pero no arranca. Pulsa JUGAR otra vez; si sigue, avisa en el Discord.");
  }
  return exe;
}

/** Java oficial de Mojang para este sistema: "java-runtime-delta" es Java 21 (el que usa Minecraft 1.21). */
async function officialJavaTarget(major: number): Promise<JavaRuntimeTarget> {
  const platform = process.platform === "win32"
    ? (process.arch === "ia32" ? "windows-x86" : process.arch === "arm64" ? "windows-arm64" : "windows-x64")
    : process.platform === "darwin" ? (process.arch === "arm64" ? "mac-os-arm64" : "mac-os") : "linux";
  const res = await fetch(DEFAULT_RUNTIME_ALL_URL);
  if (!res.ok) {
    throw new Error(`No se pudo consultar Java en los servidores de Mojang (HTTP ${res.status}).`);
  }
  const all = (await res.json()) as Record<string, Record<string, JavaRuntimeTarget[]>>;
  const byName = major >= 21 ? "java-runtime-delta" : "java-runtime-gamma";
  const target = all[platform]?.[byName]?.[0];
  if (!target) {
    throw new Error(`Mojang no ofrece Java ${major} para este sistema (${platform}).`);
  }
  return target;
}

// ------------------------------------------------------------------ Minecraft

/** Minecraft "vanilla": version, juego, librerias y recursos (sonidos, idiomas...). */
export async function ensureMinecraft(paths: Paths, version: string, onProgress: OnProgress): Promise<void> {
  const folder = new MinecraftFolder(paths.minecraft);
  const label = `Descargando Minecraft ${version}`;
  await withRetries(async () => {
    if (fs.existsSync(folder.getVersionJson(version))) {
      // Ya instalado (o a medias): comprobar el juego, librerias y recursos; baja lo que falte o este danado
      await run(label, installDependenciesTask(await Version.parse(folder, version), DOWNLOAD), onProgress);
      return;
    }
    const list = await getVersionList();
    const info = list.versions.find((v) => v.id === version);
    if (!info) {
      throw new Error(`Mojang no tiene la versión ${version} de Minecraft.`);
    }
    await run(label, installTask(info, folder, DOWNLOAD), onProgress);
  });
}

// ------------------------------------------------------------------ NeoForge

/** NeoForge con su instalador oficial (sin ventanas). Devuelve el id de la version para arrancar. */
export async function ensureNeoForge(paths: Paths, neoforge: string, java: string, onProgress: OnProgress): Promise<string> {
  const folder = new MinecraftFolder(paths.minecraft);
  const id = `neoforge-${neoforge}`;
  if (fs.existsSync(folder.getVersionJson(id))) {
    try {
      await withRetries(async () => run(`Comprobando NeoForge ${neoforge}`, installDependenciesTask(await Version.parse(folder, id), DOWNLOAD), onProgress));
      return id;
    } catch {
      // version danada: se reinstala
    }
  }
  return withRetries(async () => {
    const installed = await run(`Instalando NeoForge ${neoforge}`, installNeoForgedTask("neoforge", neoforge, folder, { java, ...DOWNLOAD }), onProgress);
    await run(`Completando NeoForge ${neoforge}`, installDependenciesTask(await Version.parse(folder, installed), DOWNLOAD), onProgress);
    return installed;
  });
}

// ------------------------------------------------------------------ comprobaciones previas

/** Espacio libre en la unidad (bytes), o Infinity si no se puede saber. */
export async function freeSpace(dir: string): Promise<number> {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const s = await fs.promises.statfs(dir);
    return s.bavail * s.bsize;
  } catch {
    return Infinity;
  }
}
