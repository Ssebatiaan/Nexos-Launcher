// Interfaz del Nexos Launcher: cambia de vista, botones de la ventana y opciones.
// Lo que necesita el sistema (archivos, enlaces, ventana) se pide al proceso principal por window.nexos (preload).

interface NexosApi {
  minimize(): void;
  close(): void;
  openDiscord(): void;
  readOptions(): Promise<{ ramMb: number }>;
  saveOptions(options: { ramMb: number }): Promise<void>;
  version(): Promise<string>;
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

// ---- jugar (se hace en el Sprint 2)
$("play-btn").addEventListener("click", () => {
  $("progress").classList.remove("hidden");
  $("progress-text").textContent = "La instalación del juego llega en el Sprint 2.";
});

export {};
