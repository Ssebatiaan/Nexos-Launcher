// Interfaz del Nexos Launcher: cambia de vista, botones de la ventana y opciones.
// Lo que necesita el sistema (archivos, enlaces, ventana) se pide al proceso principal por window.nexos (preload).

interface NexosApi {
  minimize(): void;
  close(): void;
  openDiscord(): void;
  readOptions(): Promise<{ ramMb: number }>;
  saveOptions(options: { ramMb: number }): Promise<void>;
  version(): Promise<string>;
  syncPack(): Promise<{ version: string; downloaded: number; removed: number; unchanged: number; minecraft: string; neoforge: string }>;
  onPackProgress(cb: (p: Progress) => void): void;
}

interface Progress {
  phase: "comprobando" | "descargando" | "listo";
  done: number;
  total: number;
  bytesDone: number;
  bytesTotal: number;
  current?: string;
}

declare global {
  interface Window {
    nexos: NexosApi;
  }
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// ---- ventana
$("btn-min").addEventListener("click", () => window.nexos.minimize());
$("btn-close").addEventListener("click", () => window.nexos.close());
$("btn-discord").addEventListener("click", () => window.nexos.openDiscord());
window.nexos.version().then((v) => ($("version").textContent = "v" + v));

// ---- menu lateral
for (const item of Array.from(document.querySelectorAll<HTMLButtonElement>(".nav-item"))) {
  item.addEventListener("click", () => {
    document.querySelectorAll(".nav-item").forEach((n) => n.classList.remove("active"));
    document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
    item.classList.add("active");
    $("view-" + item.dataset.view).classList.add("active");
  });
}

// ---- opciones: memoria
const ram = $<HTMLInputElement>("ram");
const ramLabel = $("ram-label");
let savedTimer: number | undefined;

function showRam(mb: number): void {
  ramLabel.textContent = (mb / 1024).toFixed(mb % 1024 === 0 ? 0 : 1) + " GB";
}

window.nexos.readOptions().then((o) => {
  ram.value = String(o.ramMb);
  showRam(o.ramMb);
});
ram.addEventListener("input", () => showRam(Number(ram.value)));
ram.addEventListener("change", async () => {
  await window.nexos.saveOptions({ ramMb: Number(ram.value) });
  const saved = $("saved");
  saved.classList.remove("hidden");
  window.clearTimeout(savedTimer);
  savedTimer = window.setTimeout(() => saved.classList.add("hidden"), 1500);
});

// ---- jugar: por ahora comprueba y actualiza el modpack (abrir el juego llega en el Sprint 2)
const playBtn = $<HTMLButtonElement>("play-btn");
const progressText = $("progress-text");
const progressFill = $("progress-fill");
const mb = (n: number) => (n / 1e6).toFixed(1);

window.nexos.onPackProgress((p) => {
  if (p.phase === "comprobando") {
    progressText.textContent = `Comprobando archivos… ${p.done}/${p.total}`;
    progressFill.style.width = `${(p.done / Math.max(1, p.total)) * 100}%`;
  } else if (p.phase === "descargando") {
    progressText.textContent = `Descargando ${p.done}/${p.total} · ${mb(p.bytesDone)} de ${mb(p.bytesTotal)} MB`;
    progressFill.style.width = `${(p.bytesDone / Math.max(1, p.bytesTotal)) * 100}%`;
  }
});

playBtn.addEventListener("click", async () => {
  playBtn.disabled = true;
  playBtn.textContent = "…";
  $("progress").classList.remove("hidden");
  progressFill.style.width = "0";
  try {
    const r = await window.nexos.syncPack();
    progressFill.style.width = "100%";
    progressText.textContent = `Modpack al día (versión ${r.version}): ${r.downloaded} descargados, ${r.removed} quitados. `
      + "Abrir el juego llega en el Sprint 2.";
  } catch (e) {
    progressText.textContent = "Error: " + (e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : e);
  } finally {
    playBtn.disabled = false;
    playBtn.textContent = "JUGAR";
  }
});

export {};
