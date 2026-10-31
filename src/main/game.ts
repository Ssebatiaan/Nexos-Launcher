// Abre Minecraft con NeoForge (en el menu principal: el jugador entra con el boton "Jugar en Nexos MC") y vigila el proceso.
import { createMinecraftProcessWatcher, launch } from "@xmcl/core";
import type { ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { Account } from "./accounts";
import { CLIENT_ID } from "./microsoft";
import { GameLogText } from "./gamelog";
import type { Paths } from "./installer";

export interface LaunchRequest {
  paths: Paths;
  versionId: string;
  java: string;
  account: Account;
  ramMb: number;
  /** Cuentas premium: token de Minecraft y XUID (sin esto, modo no premium). */
  premium?: { accessToken: string; xuid: string };
  /** Tamano de la ventana o pantalla completa; sin esto, lo que recuerde el juego. */
  resolution?: { width?: number; height?: number; fullscreen?: boolean };
  /** Solo pruebas (NEXOS_PRUEBA_ENTRAR=1): entra directo a este servidor. Normalmente se abre el menu del juego. */
  server?: { host: string; port: number };
  /** Archivo donde se guarda todo lo que escribe el juego (para "Ver registro"). */
  logFile: string;
  launcherVersion: string;
}

export interface GameEvents {
  onWindowReady(): void;
  onExit(info: { code: number | null; crashReport?: string; crashReportLocation?: string }): void;
  onError(error: Error): void;
}

export async function launchGame(req: LaunchRequest, events: GameEvents): Promise<ChildProcess> {
  fs.mkdirSync(path.dirname(req.logFile), { recursive: true });
  const log = fs.createWriteStream(req.logFile, { flags: "w" });
  log.write(`[Nexos Launcher ${req.launcherVersion}] ${new Date().toISOString()} · ${req.versionId} · ${req.account.name} · ${req.ramMb} MB\n`);
  const proc = await launch({
    gamePath: req.paths.game,
    resourcePath: req.paths.minecraft,
    javaPath: req.java,
    version: req.versionId,
    gameProfile: { name: req.account.name, id: req.account.uuid },
    accessToken: req.premium?.accessToken ?? "0",
    // Sin userType @xmcl pone "msa" (cuenta de Microsoft)
    userType: req.premium ? undefined : "legacy",
    // Valores de ${auth_xuid} y ${clientid} de los argumentos del juego (si no, quedan tal cual)
    features: { nexos: { auth_xuid: req.premium?.xuid || "0", clientid: CLIENT_ID } } as unknown as Record<string, boolean>,
    minMemory: Math.min(2048, req.ramMb),
    maxMemory: req.ramMb,
    launcherName: "nexos-launcher",
    launcherBrand: "Nexos Launcher",
    resolution: req.resolution,
    quickPlayMultiplayer: req.server ? `${req.server.host}:${req.server.port}` : undefined,
    extraExecOption: { windowsHide: true },
  });
  proc.stdout?.pipe(new GameLogText()).pipe(log, { end: false });
  proc.stderr?.pipe(new GameLogText()).pipe(log, { end: false });
  const watcher = createMinecraftProcessWatcher(proc);
  watcher.on("minecraft-window-ready", () => events.onWindowReady());
  watcher.on("minecraft-exit", (e) => {
    log.end(`\n[Nexos Launcher] El juego se cerró (código ${e.code}).\n`);
    events.onExit({ code: e.code, crashReport: e.crashReport, crashReportLocation: e.crashReportLocation });
  });
  watcher.on("error", (e) => {
    log.end(`\n[Nexos Launcher] Error al abrir el juego: ${e}\n`);
    events.onError(e instanceof Error ? e : new Error(String(e)));
  });
  return proc;
}
