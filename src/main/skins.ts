// Skins del launcher: historial (skins/historial.json + las PNG en skins/), la elegida por cada cuenta y lo que se
// deja en la carpeta del juego (nexos/skin.json y nexos/skin.png) para que Nexus Protect la mande al entrar al
// servidor (alli se pone con Skin Restorer).
import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

export interface SkinEntry {
  id: string;
  /** png = archivo propio; premium = la de un jugador premium (name). */
  kind: "png" | "premium";
  name: string;
  variant: "classic" | "slim";
  file: string;
  sha1: string;
  added: string;
}

export interface SkinView extends SkinEntry {
  /** La imagen como data: URL (para el visor 3D y las miniaturas). */
  image: string;
}

interface SkinsData {
  history: SkinEntry[];
  byAccount: Record<string, string>;
}

const MAX_HISTORY = 12;
const MAX_BYTES = 24 * 1024;

/** Comprueba que sea una PNG de skin (64x64 o 64x32, como mucho 24 KB). */
export function checkSkinPng(png: Buffer): void {
  if (png.length > MAX_BYTES) {
    throw new Error("Esa imagen es demasiado grande para ser una skin (máximo 24 KB).");
  }
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (png.length < 24 || !png.subarray(0, 8).equals(sig)) {
    throw new Error("Ese archivo no es una imagen PNG.");
  }
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  if (width !== 64 || (height !== 64 && height !== 32)) {
    throw new Error(`Una skin mide 64×64 píxeles (esta mide ${width}×${height}).`);
  }
}

export class Skins {
  private readonly dir: string;
  private readonly file: string;

  constructor(root: string) {
    this.dir = path.join(root, "skins");
    this.file = path.join(this.dir, "historial.json");
  }

  list(accountId?: string): { selected?: string; history: SkinView[] } {
    const data = this.read();
    const history = data.history
      .filter((e) => fs.existsSync(path.join(this.dir, e.file)))
      .map((e) => ({ ...e, image: "data:image/png;base64," + fs.readFileSync(path.join(this.dir, e.file)).toString("base64") }));
    return { selected: accountId ? data.byAccount[accountId] : undefined, history };
  }

  /** Anade una PNG del PC al historial y la elige para la cuenta. */
  addPng(accountId: string, source: string, variant: "classic" | "slim"): SkinEntry {
    const png = fs.readFileSync(source);
    checkSkinPng(png);
    const name = path.basename(source, path.extname(source)).replace(/[^\w\- ]/g, "").slice(0, 24) || "Mi skin";
    return this.add(accountId, png, { kind: "png", name, variant });
  }

  /** Baja la skin de un jugador premium (API oficial de Mojang) y la elige para la cuenta. */
  async addPremium(accountId: string, name: string): Promise<SkinEntry> {
    if (!/^\w{3,16}$/.test(name)) {
      throw new Error("Escribe el nombre exacto de un jugador premium (3 a 16 letras, números o _).");
    }
    const profileRes = await fetch(`https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(name)}`);
    if (profileRes.status === 404 || profileRes.status === 204) {
      throw new Error(`No existe ningún jugador premium llamado «${name}».`);
    }
    if (!profileRes.ok) {
      throw new Error("Mojang no responde ahora mismo. Prueba en un rato.");
    }
    const profile = (await profileRes.json()) as { id: string; name: string };
    const sessionRes = await fetch(`https://sessionserver.mojang.com/session/minecraft/profile/${profile.id}`);
    if (!sessionRes.ok) {
      throw new Error("Mojang no responde ahora mismo. Prueba en un rato.");
    }
    const session = (await sessionRes.json()) as { properties: Array<{ name: string; value: string }> };
    const textures = session.properties.find((p) => p.name === "textures");
    const decoded = textures ? JSON.parse(Buffer.from(textures.value, "base64").toString("utf-8")) : {};
    const skin = decoded.textures?.SKIN as { url: string; metadata?: { model?: string } } | undefined;
    if (!skin) {
      throw new Error(`«${profile.name}» usa la skin por defecto (no tiene una propia).`);
    }
    const pngRes = await fetch(skin.url.replace(/^http:/, "https:"));
    if (!pngRes.ok) {
      throw new Error("No se pudo descargar la skin. Prueba en un rato.");
    }
    const png = Buffer.from(await pngRes.arrayBuffer());
    checkSkinPng(png);
    return this.add(accountId, png, { kind: "premium", name: profile.name, variant: skin.metadata?.model === "slim" ? "slim" : "classic" });
  }

  select(accountId: string, id: string | null): void {
    const data = this.read();
    if (id === null) {
      delete data.byAccount[accountId];
    } else if (data.history.some((e) => e.id === id)) {
      data.byAccount[accountId] = id;
    }
    this.write(data);
  }

  setVariant(id: string, variant: "classic" | "slim"): void {
    const data = this.read();
    const entry = data.history.find((e) => e.id === id);
    if (entry && entry.kind === "png") {
      entry.variant = variant;
      this.write(data);
    }
  }

  remove(id: string): void {
    const data = this.read();
    const entry = data.history.find((e) => e.id === id);
    if (!entry) return;
    data.history = data.history.filter((e) => e.id !== id);
    for (const [account, skin] of Object.entries(data.byAccount)) {
      if (skin === id) delete data.byAccount[account];
    }
    if (!data.history.some((e) => e.file === entry.file)) {
      fs.rmSync(path.join(this.dir, entry.file), { force: true });
    }
    this.write(data);
  }

  /** Deja la skin de la cuenta en la carpeta del juego (o la quita si no tiene ninguna elegida). */
  writeToGame(gameDir: string, accountId: string): void {
    const data = this.read();
    const entry = data.history.find((e) => e.id === data.byAccount[accountId]);
    const out = path.join(gameDir, "nexos");
    fs.mkdirSync(out, { recursive: true });
    const json = path.join(out, "skin.json");
    const png = path.join(out, "skin.png");
    if (!entry) {
      fs.rmSync(json, { force: true });
      fs.rmSync(png, { force: true });
      return;
    }
    if (entry.kind === "png") {
      fs.copyFileSync(path.join(this.dir, entry.file), png);
    } else {
      fs.rmSync(png, { force: true });
    }
    fs.writeFileSync(json, JSON.stringify({ kind: entry.kind, name: entry.kind === "premium" ? entry.name : "", variant: entry.variant }, null, 2), "utf-8");
  }

  private add(accountId: string, png: Buffer, info: Pick<SkinEntry, "kind" | "name" | "variant">): SkinEntry {
    const data = this.read();
    const sha1 = createHash("sha1").update(png).digest("hex");
    let entry = data.history.find((e) => e.sha1 === sha1 && e.kind === info.kind && e.name === info.name);
    if (!entry) {
      fs.mkdirSync(this.dir, { recursive: true });
      const file = `${sha1}.png`;
      fs.writeFileSync(path.join(this.dir, file), png);
      entry = { id: randomUUID(), ...info, file, sha1, added: new Date().toISOString() };
    } else if (info.kind === "png") {
      entry.variant = info.variant;
    }
    // La mas reciente arriba; el historial guarda como mucho 12
    data.history = [entry, ...data.history.filter((e) => e.id !== entry!.id)];
    for (const old of data.history.splice(MAX_HISTORY)) {
      if (!Object.values(data.byAccount).includes(old.id) && !data.history.some((e) => e.file === old.file)) {
        fs.rmSync(path.join(this.dir, old.file), { force: true });
      } else {
        data.history.push(old); // en uso por otra cuenta: se queda
      }
    }
    data.byAccount[accountId] = entry.id;
    this.write(data);
    return entry;
  }

  private read(): SkinsData {
    try {
      const data = JSON.parse(fs.readFileSync(this.file, "utf-8")) as SkinsData;
      return { history: data.history ?? [], byAccount: data.byAccount ?? {} };
    } catch {
      return { history: [], byAccount: {} };
    }
  }

  private write(data: SkinsData): void {
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(data, null, 2), "utf-8");
  }
}
