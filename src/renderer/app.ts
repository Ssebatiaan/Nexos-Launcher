// Interfaz del Nexos Launcher: vistas, cuentas, opciones y el boton JUGAR (con los pasos de la preparacion).
// Lo que necesita el sistema (archivos, instalar, abrir el juego) se pide al proceso principal por window.nexos (preload).

interface Account {
  id: string;
  type: "offline";
  name: string;
  uuid: string;
}

type StepState = "pendiente" | "activo" | "hecho" | "error";

interface PlayState {
  steps: Array<{ id: string; label: string; state: StepState }>;
  text: string;
  percent: number | null;
  phase: "preparando" | "jugando" | "terminado" | "error";
  error?: string;
  canOpenLog?: boolean;
}

interface NexosApi {
  minimize(): void;
  close(): void;
  openDiscord(): void;
  openLog(): void;
  readOptions(): Promise<{ ramMb: number }>;
  saveOptions(options: { ramMb: number }): Promise<void>;
  version(): Promise<string>;
  systemInfo(): Promise<{ totalMb: number }>;
  listAccounts(): Promise<{ selected?: string; accounts: Account[] }>;
  addOfflineAccount(name: string): Promise<Account>;
  selectAccount(id: string): Promise<void>;
  removeAccount(id: string): Promise<void>;
  play(): Promise<boolean>;
  onPlayState(cb: (s: PlayState) => void): void;
}

declare global {
  interface Window {
    nexos: NexosApi;
    /** Ultimo estado de JUGAR (lo lee el modo de prueba del proceso principal). */
    __estado?: PlayState;
  }
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const nexos = window.nexos;

/** Mensaje de un error del proceso principal sin el prefijo que anade Electron. */
function cleanError(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
}

// ---- ventana
$("btn-min").addEventListener("click", () => nexos.minimize());
$("btn-close").addEventListener("click", () => nexos.close());
$("btn-discord").addEventListener("click", () => nexos.openDiscord());
nexos.version().then((v) => ($("version").textContent = "v" + v));

// ---- menu lateral
for (const item of Array.from(document.querySelectorAll<HTMLButtonElement>(".nav-item"))) {
  item.addEventListener("click", () => {
    document.querySelectorAll(".nav-item").forEach((n) => n.classList.remove("active"));
    document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
    item.classList.add("active");
    $("view-" + item.dataset.view).classList.add("active");
  });
}

// ---- opciones: memoria (como mucho la RAM del PC menos 2 GB para Windows)
const ram = $<HTMLInputElement>("ram");
const ramLabel = $("ram-label");
let savedTimer: number | undefined;
const gb = (mb: number) => (mb / 1024).toFixed(mb % 1024 === 0 ? 0 : 1) + " GB";

Promise.all([nexos.readOptions(), nexos.systemInfo()]).then(([o, sys]) => {
  const max = Math.max(3072, Math.min(16384, Math.floor((sys.totalMb - 2048) / 512) * 512));
  ram.max = String(max);
  ram.value = String(Math.min(o.ramMb, max));
  ramLabel.textContent = gb(Number(ram.value));
  $("ram-info").textContent = `Tu PC tiene ${gb(sys.totalMb)} de RAM. Recomendado: 5 GB (más no hace el juego más rápido y deja sin memoria a Windows).`;
});
ram.addEventListener("input", () => (ramLabel.textContent = gb(Number(ram.value))));
ram.addEventListener("change", async () => {
  await nexos.saveOptions({ ramMb: Number(ram.value) });
  const saved = $("saved");
  saved.classList.remove("hidden");
  window.clearTimeout(savedTimer);
  savedTimer = window.setTimeout(() => saved.classList.add("hidden"), 1500);
});

// ---- cuentas
const modal = $("account-modal");
const nameInput = $<HTMLInputElement>("account-name-input");
const accountError = $("account-error");

async function refreshAccounts(): Promise<Account | undefined> {
  const { selected, accounts } = await nexos.listAccounts();
  const current = accounts.find((a) => a.id === selected) ?? accounts[0];
  $("account-name").textContent = current ? current.name : "Sin cuenta";
  $("account-type").textContent = current ? "No premium · cambiar" : "Añade una cuenta para jugar";
  $("avatar").textContent = current ? current.name[0].toUpperCase() : "?";
  const list = $("account-list");
  list.innerHTML = "";
  if (accounts.length === 0) {
    list.innerHTML = '<li class="empty">Todavía no hay cuentas.</li>';
  }
  for (const a of accounts) {
    const li = document.createElement("li");
    li.className = a.id === current?.id ? "selected" : "";
    li.innerHTML = `<div class="mini-avatar"></div><div class="who"><span></span><small>No premium</small></div>
      <button class="remove" title="Quitar esta cuenta">✕</button>`;
    li.querySelector(".mini-avatar")!.textContent = a.name[0].toUpperCase();
    li.querySelector(".who span")!.textContent = a.name;
    li.addEventListener("click", async () => {
      await nexos.selectAccount(a.id);
      await refreshAccounts();
      modal.classList.add("hidden");
    });
    li.querySelector(".remove")!.addEventListener("click", async (ev) => {
      ev.stopPropagation();
      await nexos.removeAccount(a.id);
      await refreshAccounts();
    });
    list.appendChild(li);
  }
  return current;
}

function openAccounts(): void {
  accountError.classList.add("hidden");
  nameInput.value = "";
  modal.classList.remove("hidden");
  nameInput.focus();
}

async function addAccount(): Promise<void> {
  try {
    await nexos.addOfflineAccount(nameInput.value);
    await refreshAccounts();
    modal.classList.add("hidden");
  } catch (e) {
    accountError.textContent = cleanError(e);
    accountError.classList.remove("hidden");
  }
}

$("account").addEventListener("click", openAccounts);
$("account-close").addEventListener("click", () => modal.classList.add("hidden"));
modal.addEventListener("click", (e) => e.target === modal && modal.classList.add("hidden"));
$("account-add").addEventListener("click", addAccount);
nameInput.addEventListener("keydown", (e) => e.key === "Enter" && addAccount());
refreshAccounts();

// ---- jugar
const playBtn = $<HTMLButtonElement>("play-btn");
const ICONS: Record<StepState, string> = { pendiente: "", activo: "", hecho: "✔", error: "✕" };

nexos.onPlayState((s) => {
  window.__estado = s;
  $("steps").classList.remove("hidden");
  const list = $("steps-list");
  list.innerHTML = "";
  for (const step of s.steps) {
    const li = document.createElement("li");
    li.className = step.state;
    li.innerHTML = `<span class="icon">${ICONS[step.state]}</span><span></span>`;
    li.lastElementChild!.textContent = step.label;
    list.appendChild(li);
  }
  $("progress").classList.toggle("hidden", s.phase === "error");
  $("progress-text").textContent = s.text;
  const fill = $("progress-fill");
  fill.style.width = s.percent === null ? (s.phase === "jugando" || s.phase === "terminado" ? "100%" : "0") : `${s.percent}%`;
  $("error-box").classList.toggle("hidden", s.phase !== "error");
  $("error-text").textContent = s.error ?? "";
  $("btn-log").classList.toggle("hidden", !s.canOpenLog);
  playBtn.disabled = s.phase === "preparando" || s.phase === "jugando";
  playBtn.textContent = s.phase === "preparando" ? "…" : s.phase === "jugando" ? "JUGANDO" : "JUGAR";
});

async function play(): Promise<void> {
  const account = await refreshAccounts();
  if (!account) {
    openAccounts();
    return;
  }
  playBtn.disabled = true;
  playBtn.textContent = "…";
  try {
    await nexos.play();
  } catch (e) {
    $("steps").classList.remove("hidden");
    $("error-box").classList.remove("hidden");
    $("error-text").textContent = cleanError(e);
    playBtn.disabled = false;
    playBtn.textContent = "JUGAR";
  }
}

playBtn.addEventListener("click", play);
$("btn-retry").addEventListener("click", play);
$("btn-log").addEventListener("click", () => nexos.openLog());

export {};
