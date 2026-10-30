// Abre Minecraft con NeoForge (en el menu principal: el jugador entra con el boton "Jugar en Nexos MC") y vigila el proceso.
import { createMinecraftProcessWatcher, launch } from "@xmcl/core";
import type { ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { Account } from "./accounts";
import { GameLogText } from "./gamelog";
import type { Paths } from "./installer";

export interface LaunchRequest {
  paths: Paths;
  versionId: string;
  java: string;
  account: Account;
  ramMb: number;
  /** Tamano de la ventana o pantalla completa; sin esto, lo que recuerde el juego. */
  resolution?: { width?: number; height?: number; fullscreen?: boolean };
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
    accessToken: "0",
    userType: "legacy",
    minMemory: Math.min(2048, req.ramMb),
    maxMemory: req.ramMb,
    launcherName: "nexos-launcher",
    launcherBrand: "Nexos Launcher",
    resolution: req.resolution,
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
