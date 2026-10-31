// Modpack de Nexos MC: lee pack.json (lo genera tools/build_launcher_pack.py en la rama "pack") y deja la carpeta del
// juego igual que la lista: baja lo que falta o cambio (comprobando el SHA-1), borra lo que se quito del paquete y no
// toca nada mas (los mods que el jugador anada por su cuenta se quedan).
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

export interface PackFile {
  path: string;
  url: string;
  sha1: string;
  size: number;
  /** Solo se escribe si no existe (servers.dat: no se pisan los servidores del jugador). */
  onlyIfMissing?: boolean;
  /** Ajuste de partida que el jugador puede cambiar: si ya no es el que puso el launcher, no se toca. */
  keepIfChanged?: boolean;
}

/** Novedades que se ven en el launcher (client-pack/noticias.json del proyecto del servidor). */
export interface NewsItem {
  fecha: string;
  titulo: string;
  texto: string;
  etiqueta?: string;
}

export interface Pack {
  formatVersion: number;
  name: string;
  version: string;
  minecraft: string;
  neoforge: string;
  java: number;
  ramMb: number;
  server: { name: string; host: string; port: number };
  files: PackFile[];
  news?: NewsItem[];
}

/** Lo instalado en la ultima sincronizacion (para borrar lo que se quite y no recalcular huellas sin necesidad). */
interface State {
  version: string;
  files: Record<string, { sha1: string; size: number; mtimeMs: number }>;
}

export interface Progress {
  phase: "comprobando" | "descargando" | "listo";
  done: number;
  total: number;
  bytesDone: number;
  bytesTotal: number;
  current?: string;
}

export interface SyncResult {
  version: string;
  downloaded: number;
  removed: number;
  unchanged: number;
}

const STATE_FILE = ".nexos-pack.json";
const PARALLEL = 6;
const RETRIES = 3;

/** Lee pack.json de una URL (https o file) o de una ruta local. */
export async function fetchPack(source: string): Promise<Pack> {
  const text = await readText(source);
  const pack = JSON.parse(text) as Pack;
  if (pack.formatVersion !== 1 || !Array.isArray(pack.files)) {
    throw new Error("pack.json con un formato que este launcher no entiende (actualiza el launcher)");
  }
  return pack;
}

async function readText(source: string): Promise<string> {
  if (source.startsWith("file:")) {
    return fs.promises.readFile(fileURLToPath(source), "utf-8");
  }
  if (!/^https?:/.test(source)) {
    return fs.promises.readFile(source, "utf-8");
  }
  const res = await fetch(source, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`No se pudo leer la lista del modpack (HTTP ${res.status})`);
  }
  return res.text();
}

/** Deja gameDir igual que el paquete. onProgress se llama a menudo (para la barra). */
export async function syncPack(pack: Pack, gameDir: string, onProgress: (p: Progress) => void = () => {},
  options: { full?: boolean } = {}): Promise<SyncResult> {
  fs.mkdirSync(gameDir, { recursive: true });
  const state = readState(gameDir);
  const next: State = { version: pack.version, files: {} };

  // 1. Que falta o cambio
  const todo: PackFile[] = [];
  let checked = 0;
  for (const f of pack.files) {
    const target = safePath(gameDir, f.path);
    onProgress({ phase: "comprobando", done: checked++, total: pack.files.length, bytesDone: 0, bytesTotal: 0, current: f.path });
    if (!fs.existsSync(target)) {
      todo.push(f);
      continue;
    }
    if (f.onlyIfMissing) {
      continue; // existe: es del jugador
    }
    const st = fs.statSync(target);
    const known = state.files[f.path];
    // full (Reparar instalacion): se recalcula la huella de todo, sin fiarse de lo anotado
    const sha1 = !options.full && known && known.size === st.size && known.mtimeMs === st.mtimeMs ? known.sha1 : await sha1Of(target);
    if (sha1 === f.sha1) {
      next.files[f.path] = { sha1, size: st.size, mtimeMs: st.mtimeMs };
    } else if (f.keepIfChanged && (!known || sha1 !== known.sha1)) {
      // Ya no es el que pusimos: el jugador cambio sus ajustes y se respetan (se sigue anotando el nuestro para
      // saberlo tambien la proxima vez)
      if (known) next.files[f.path] = known;
    } else {
      todo.push(f);
    }
  }

  // 2. Bajar (varios a la vez)
  const bytesTotal = todo.reduce((n, f) => n + f.size, 0);
  let bytesDone = 0;
  let done = 0;
  const queue = [...todo];
  const worker = async () => {
    for (let f = queue.shift(); f; f = queue.shift()) {
      const file = f;
      await download(file, safePath(gameDir, file.path), (n) => {
        bytesDone += n;
        onProgress({ phase: "descargando", done, total: todo.length, bytesDone, bytesTotal, current: file.path });
      });
      done++;
      const st = fs.statSync(safePath(gameDir, file.path));
      if (!file.onlyIfMissing) {
        next.files[file.path] = { sha1: file.sha1, size: st.size, mtimeMs: st.mtimeMs };
      }
      onProgress({ phase: "descargando", done, total: todo.length, bytesDone, bytesTotal, current: file.path });
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL, todo.length) }, worker));

  // 3. Borrar lo que estaba en el paquete anterior y ya no esta
  const wanted = new Set(pack.files.map((f) => f.path));
  let removed = 0;
  for (const old of Object.keys(state.files)) {
    if (!wanted.has(old)) {
      const target = safePath(gameDir, old);
      if (fs.existsSync(target)) {
        fs.rmSync(target);
        removed++;
      }
    }
  }

  writeState(gameDir, next);
  onProgress({ phase: "listo", done: todo.length, total: todo.length, bytesDone: bytesTotal, bytesTotal });
  return { version: pack.version, downloaded: todo.length, removed, unchanged: pack.files.length - todo.length };
}

/** Descarga a un temporal, comprueba tamano y SHA-1 y lo mueve a su sitio (reintenta si falla). */
async function download(f: PackFile, target: string, onBytes: (n: number) => void): Promise<void> {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = target + ".descarga";
  let lastError: unknown;
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    let counted = 0;
    try {
      if (f.url.startsWith("file:")) {
        await fs.promises.copyFile(fileURLToPath(f.url), tmp);
        counted = f.size;
        onBytes(f.size);
      } else {
        const res = await fetch(f.url);
        if (!res.ok || !res.body) {
          throw new Error(`HTTP ${res.status}`);
        }
        const out = fs.createWriteStream(tmp);
        for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
          out.write(chunk);
          counted += chunk.length;
          onBytes(chunk.length);
        }
        await new Promise<void>((ok, fail) => out.end((e?: Error | null) => (e ? fail(e) : ok())));
      }
      const sha1 = await sha1Of(tmp);
      if (sha1 !== f.sha1) {
        throw new Error(`la huella no coincide (${sha1} en vez de ${f.sha1})`);
      }
      fs.renameSync(tmp, target);
      return;
    } catch (e) {
      lastError = e;
      onBytes(-counted); // la barra no cuenta lo descargado de un intento fallido
      fs.rmSync(tmp, { force: true });
    }
  }
  throw new Error(`No se pudo descargar ${f.path}: ${lastError instanceof Error ? lastError.message : lastError}`);
}

function sha1Of(file: string): Promise<string> {
  return new Promise((ok, fail) => {
    const h = createHash("sha1");
    fs.createReadStream(file)
      .on("data", (d) => h.update(d))
      .on("end", () => ok(h.digest("hex")))
      .on("error", fail);
  });
}

/** Ruta dentro de gameDir (nunca fuera, aunque pack.json trajera "../"). */
function safePath(gameDir: string, rel: string): string {
  const target = path.resolve(gameDir, rel);
  if (!target.startsWith(path.resolve(gameDir) + path.sep)) {
    throw new Error(`Ruta no permitida en el modpack: ${rel}`);
  }
  return target;
}

/** Version del modpack instalada en gameDir (la de la ultima sincronizacion), o undefined. */
export function installedVersion(gameDir: string): string | undefined {
  return readState(gameDir).version || undefined;
}

function readState(gameDir: string): State {
  try {
    return JSON.parse(fs.readFileSync(path.join(gameDir, STATE_FILE), "utf-8")) as State;
  } catch {
    return { version: "", files: {} };
  }
}

function writeState(gameDir: string, state: State): void {
  fs.writeFileSync(path.join(gameDir, STATE_FILE), JSON.stringify(state, null, 2), "utf-8");
}
