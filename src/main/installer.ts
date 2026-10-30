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
export async function ensureJava(paths: Paths, major: number, onProgress: OnProgress): Promise<string> {
  const exe = path.join(paths.java, "bin", process.platform === "win32" ? "java.exe" : "java");
  if (fs.existsSync(exe)) {
    const info = await resolveJava(exe).catch(() => undefined);
    if (info && info.majorVersion >= major) {
      return exe;
    }
  }
  const target = await officialJavaTarget(major);
  fs.rmSync(paths.java, { recursive: true, force: true });
  await run(`Instalando Java ${major}`, installJavaRuntimeWithJsonTask({ target, destination: paths.java }), onProgress);
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
  if (fs.existsSync(folder.getVersionJson(version))) {
    // Ya instalado: solo comprobar librerias y recursos (baja lo que falte o este danado)
    await run(label, installDependenciesTask(await Version.parse(folder, version)), onProgress);
    return;
  }
  const list = await getVersionList();
  const info = list.versions.find((v) => v.id === version);
  if (!info) {
    throw new Error(`Mojang no tiene la versión ${version} de Minecraft.`);
  }
  await run(label, installTask(info, folder), onProgress);
}

// ------------------------------------------------------------------ NeoForge

/** NeoForge con su instalador oficial (sin ventanas). Devuelve el id de la version para arrancar. */
export async function ensureNeoForge(paths: Paths, neoforge: string, java: string, onProgress: OnProgress): Promise<string> {
  const folder = new MinecraftFolder(paths.minecraft);
  const id = `neoforge-${neoforge}`;
  if (fs.existsSync(folder.getVersionJson(id))) {
    try {
      await run(`Comprobando NeoForge ${neoforge}`, installDependenciesTask(await Version.parse(folder, id)), onProgress);
      return id;
    } catch {
      // version danada: se reinstala
    }
  }
  const installed = await run(`Instalando NeoForge ${neoforge}`, installNeoForgedTask("neoforge", neoforge, folder, { java }), onProgress);
  await run(`Completando NeoForge ${neoforge}`, installDependenciesTask(await Version.parse(folder, installed)), onProgress);
  return installed;
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
