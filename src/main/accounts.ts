// Cuentas guardadas (%APPDATA%/Nexos Launcher/cuentas.json). De momento las no premium; las de Microsoft llegan en
// el Sprint 4 (cuando aprueben la app).
import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

export interface Account {
  id: string;
  type: "offline";
  name: string;
  /** UUID sin guiones (el mismo que calcula el servidor para los no premium). */
  uuid: string;
}

interface AccountsFile {
  selected?: string;
  accounts: Account[];
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
    return this.read();
  }

  selected(): Account | undefined {
    const data = this.read();
    return data.accounts.find((a) => a.id === data.selected) ?? data.accounts[0];
  }

  addOffline(name: string): Account {
    const clean = name.trim();
    if (!NAME_RULE.test(clean)) {
      throw new Error("El nombre tiene que tener de 3 a 16 letras, números o guion bajo (sin espacios ni tildes).");
    }
    const data = this.read();
    const existing = data.accounts.find((a) => a.type === "offline" && a.name.toLowerCase() === clean.toLowerCase());
    const account = existing ?? { id: randomUUID(), type: "offline" as const, name: clean, uuid: offlineUuid(clean) };
    if (!existing) {
      data.accounts.push(account);
    }
    data.selected = account.id;
    this.write(data);
    return account;
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
