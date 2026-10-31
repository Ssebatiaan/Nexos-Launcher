// Cuentas guardadas (%APPDATA%/Nexos Launcher/cuentas.json): no premium (solo nombre) y premium de Microsoft. De las
// premium se guarda la sesion cifrada con la proteccion de Windows (safeStorage): solo este usuario de este PC la puede
// leer, y la interfaz nunca la ve.
import { safeStorage } from "electron";
import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { type McSession, refreshSession, SessionExpired } from "./microsoft";

export interface Account {
  id: string;
  type: "offline" | "microsoft";
  name: string;
  /** UUID sin guiones (no premium: el mismo que calcula el servidor; premium: el de Mojang). */
  uuid: string;
  /** Premium cuya sesion caduco: hay que volver a iniciar sesion. */
  needsLogin?: boolean;
}

interface StoredAccount extends Account {
  /** Sesion de Microsoft cifrada (base64). */
  secret?: string;
}

interface AccountsFile {
  selected?: string;
  accounts: StoredAccount[];
}

/** Nombre valido en Minecraft: 3 a 16 letras, numeros o guion bajo. */
export const NAME_RULE = /^[A-Za-z0-9_]{3,16}$/;

/**
 * UUID de un jugador no premium: el v3 de "OfflinePlayer:<nombre>" (igual que UUID.nameUUIDFromBytes de Java, que es
 * lo que usa el servidor en modo sin conexion). Asi sus datos en el servidor no cambian.
 */
export function offlineUuid(name: string): string {
  const b = createHash("md5").update("OfflinePlayer:" + name, "utf8").digest();
  b[6] = (b[6] & 0x0f) | 0x30;
  b[8] = (b[8] & 0x3f) | 0x80;
  return b.toString("hex");
}

const strip = ({ secret: _secret, ...account }: StoredAccount): Account => account;

export class Accounts {
  constructor(private readonly root: string) {}

  private file(): string {
    return path.join(this.root, "cuentas.json");
  }

  private read(): AccountsFile {
    try {
      const data = JSON.parse(fs.readFileSync(this.file(), "utf-8")) as AccountsFile;
      return { selected: data.selected, accounts: Array.isArray(data.accounts) ? data.accounts : [] };
    } catch {
      return { accounts: [] };
    }
  }

  private write(data: AccountsFile): void {
    fs.mkdirSync(this.root, { recursive: true });
    fs.writeFileSync(this.file(), JSON.stringify(data, null, 2), "utf-8");
  }

  list(): { selected?: string; accounts: Account[] } {
    const data = this.read();
    return { selected: data.selected, accounts: data.accounts.map(strip) };
  }

  selected(): Account | undefined {
    const data = this.read();
    const account = data.accounts.find((a) => a.id === data.selected) ?? data.accounts[0];
    return account && strip(account);
  }

  addOffline(name: string): Account {
    const clean = name.trim();
    if (!NAME_RULE.test(clean)) {
      throw new Error("El nombre tiene que tener de 3 a 16 letras, números o guion bajo (sin espacios ni tildes).");
    }
    const data = this.read();
    const existing = data.accounts.find((a) => a.type === "offline" && a.name.toLowerCase() === clean.toLowerCase());
    const account: StoredAccount = existing ?? { id: randomUUID(), type: "offline", name: clean, uuid: offlineUuid(clean) };
    if (!existing) {
      data.accounts.push(account);
    }
    data.selected = account.id;
    this.write(data);
    return strip(account);
  }

  /** Anade (o actualiza, si ya estaba) una cuenta premium tras iniciar sesion, y la elige. */
  addMicrosoft(session: McSession): Account {
    const data = this.read();
    let account = data.accounts.find((a) => a.type === "microsoft" && a.uuid === session.uuid);
    if (!account) {
      account = { id: randomUUID(), type: "microsoft", name: session.name, uuid: session.uuid };
      data.accounts.push(account);
    }
    account.name = session.name;
    account.needsLogin = undefined;
    account.secret = encrypt(session);
    data.selected = account.id;
    this.write(data);
    return strip(account);
  }

  /**
   * Token de Minecraft valido para jugar o cambiar la skin (lo renueva si le quedan menos de 10 min). Si la sesion
   * ya no vale, marca la cuenta para volver a iniciar sesion y lanza un error explicado.
   */
  async minecraftSession(id: string): Promise<McSession> {
    const data = this.read();
    const account = data.accounts.find((a) => a.id === id);
    const saved = account?.secret ? decrypt(account.secret) : undefined;
    if (!account || account.type !== "microsoft" || !saved) {
      throw new Error("Vuelve a iniciar sesión con Microsoft en esta cuenta (pulsa en tu cuenta, abajo a la izquierda).");
    }
    if (saved.mcExpires - Date.now() > 10 * 60 * 1000) {
      return saved;
    }
    try {
      const fresh = await refreshSession(saved);
      account.name = fresh.name;
      account.secret = encrypt(fresh);
      this.write(data);
      return fresh;
    } catch (e) {
      if (e instanceof SessionExpired) {
        account.needsLogin = true;
        this.write(data);
        throw new Error("Tu sesión de Microsoft caducó. Pulsa en tu cuenta (abajo a la izquierda) y vuelve a iniciar sesión.");
      }
      throw e;
    }
  }

  select(id: string): void {
    const data = this.read();
    if (data.accounts.some((a) => a.id === id)) {
      data.selected = id;
      this.write(data);
    }
  }

  remove(id: string): void {
    const data = this.read();
    data.accounts = data.accounts.filter((a) => a.id !== id);
    if (data.selected === id) {
      data.selected = data.accounts[0]?.id;
    }
    this.write(data);
  }
}

function encrypt(session: McSession): string {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("Windows no deja guardar la sesión cifrada en este PC.");
  }
  return safeStorage.encryptString(JSON.stringify(session)).toString("base64");
}

function decrypt(secret: string): McSession | undefined {
  try {
    return JSON.parse(safeStorage.decryptString(Buffer.from(secret, "base64"))) as McSession;
  } catch {
    return undefined;
  }
}
