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
  mode: "jugar" | "reparar";
}

interface Options {
  ramMb: number;
  onLaunch: string;
  resolution: string;
}

interface NewsItem {
  fecha: string;
  titulo: string;
  texto: string;
  etiqueta?: string;
}

interface LauncherInfo {
  version?: string;
  installed?: string;
  news: NewsItem[];
  online: boolean;
}

interface ServerStatus {
  online: boolean;
  players?: number;
  max?: number;
  names?: string[];
  pingMs?: number;
}

interface UpdateState {
  phase: "buscando" | "al-dia" | "disponible" | "descargando" | "instalando" | "error";
  version?: string;
  percent?: number;
  error?: string;
}

interface NexosApi {
  minimize(): void;
  close(): void;
  openDiscord(): void;
  openLog(): void;
  openFolder(): void;
  readOptions(): Promise<Options>;
  saveOptions(options: Partial<Options>): Promise<void>;
  version(): Promise<string>;
  info(): Promise<LauncherInfo>;
  serverStatus(): Promise<ServerStatus>;
  systemInfo(): Promise<{ totalMb: number }>;
  listAccounts(): Promise<{ selected?: string; accounts: Account[] }>;
  addOfflineAccount(name: string): Promise<Account>;
  selectAccount(id: string): Promise<void>;
  removeAccount(id: string): Promise<void>;
  play(): Promise<boolean>;
  repair(): Promise<boolean>;
  checkUpdates(): Promise<UpdateState>;
  installUpdate(): Promise<void>;
  onPlayState(cb: (s: PlayState) => void): void;
  onUpdateState(cb: (s: UpdateState) => void): void;
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
nexos.version().then((v) => {
  $("version").textContent = "v" + v;
  $("launcher-version").textContent = "Versión " + v;
});

// ---- menu lateral
function showView(view: string): void {
  document.querySelectorAll<HTMLElement>(".nav-item").forEach((n) => n.classList.toggle("active", n.dataset.view === view));
  document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
  $("view-" + view).classList.add("active");
}

for (const item of Array.from(document.querySelectorAll<HTMLButtonElement>(".nav-item"))) {
  item.addEventListener("click", () => showView(item.dataset.view!));
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
async function saveOption(options: Partial<Options>): Promise<void> {
  await nexos.saveOptions(options);
  const saved = $("saved");
  saved.classList.remove("hidden");
  window.clearTimeout(savedTimer);
  savedTimer = window.setTimeout(() => saved.classList.add("hidden"), 1500);
}

const resolution = $<HTMLSelectElement>("resolution");
const onLaunch = $<HTMLSelectElement>("on-launch");
nexos.readOptions().then((o) => {
  resolution.value = o.resolution;
  onLaunch.value = o.onLaunch;
});
ram.addEventListener("input", () => (ramLabel.textContent = gb(Number(ram.value))));
ram.addEventListener("change", () => saveOption({ ramMb: Number(ram.value) }));
resolution.addEventListener("change", () => saveOption({ resolution: resolution.value }));
onLaunch.addEventListener("change", () => saveOption({ onLaunch: onLaunch.value }));
$("btn-folder").addEventListener("click", () => nexos.openFolder());
$("btn-log2").addEventListener("click", () => nexos.openLog());

// ---- novedades y estado del modpack
function dateText(iso: string): string {
  const d = new Date(iso + "T12:00:00");
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString("es", { day: "numeric", month: "short" });
}

function renderNews(news: NewsItem[]): void {
  const list = $("news-list");
  list.innerHTML = "";
  if (news.length === 0) {
    list.innerHTML = '<p class="muted small">Sin novedades por ahora.</p>';
    return;
  }
  for (const n of news) {
    const art = document.createElement("article");
    art.innerHTML = '<div class="meta"><span class="date"></span></div><h4></h4><p></p>';
    art.querySelector(".date")!.textContent = dateText(n.fecha);
    if (n.etiqueta) {
      const tag = document.createElement("span");
      tag.className = "tag";
      tag.textContent = n.etiqueta;
      art.querySelector(".meta")!.appendChild(tag);
    }
    art.querySelector("h4")!.textContent = n.titulo;
    art.querySelector("p")!.textContent = n.texto;
    list.appendChild(art);
  }
}

function renderPackInfo(info: LauncherInfo): void {
  const el = $("pack-info");
  if (!info.version) {
    el.textContent = "Sin conexión. Conéctate a internet para instalar el juego.";
  } else if (!info.installed) {
    el.innerHTML = "Primera vez: al pulsar <strong>JUGAR</strong> se instala todo (unos 1,5 GB).";
  } else if (info.installed === info.version) {
    el.innerHTML = "Modpack <strong></strong> · todo al día" + (info.online ? "" : " (sin conexión)");
    el.querySelector("strong")!.textContent = info.version;
  } else {
    el.innerHTML = '<span class="new"></span> · se instala al pulsar JUGAR';
    el.querySelector(".new")!.textContent = "Actualización del modpack " + info.version;
  }
}

async function refreshInfo(): Promise<void> {
  const info = await nexos.info();
  renderNews(info.news);
  renderPackInfo(info);
}
refreshInfo();

// ---- estado del servidor (cada 30 s)
async function refreshServer(): Promise<void> {
  const s = await nexos.serverStatus();
  const dot = $("server-dot");
  dot.classList.toggle("online", s.online);
  dot.classList.toggle("offline", !s.online);
  $("server-text").textContent = s.online ? `En línea · ${s.players}/${s.max} jugando` : "Servidor apagado";
  $("server-status").title = s.online
    ? (s.names && s.names.length ? "Conectados: " + s.names.join(", ") : "Nadie conectado ahora mismo") + ` · ${s.pingMs} ms`
    : "El servidor no responde: puede estar apagado o reiniciándose.";
}
refreshServer();
window.setInterval(refreshServer, 30_000);

// ---- actualizaciones del launcher (boton verde de arriba)
const updateBtn = $<HTMLButtonElement>("update-btn");
const updateResult = $("update-result");

nexos.onUpdateState((u) => {
  const busy = u.phase === "descargando" || u.phase === "instalando";
  updateBtn.classList.toggle("busy", busy);
  updateBtn.disabled = busy;
  if (u.phase === "disponible") {
    updateBtn.textContent = `⬇ Actualización lista (v${u.version})`;
    updateBtn.title = "Pulsa para descargar la versión nueva del launcher; se reinicia solo al terminar.";
  } else if (u.phase === "descargando") {
    updateBtn.textContent = `Descargando… ${u.percent ?? 0} %`;
  } else if (u.phase === "instalando") {
    updateBtn.textContent = "Reiniciando…";
  } else if (u.phase === "error") {
    updateBtn.textContent = "⬇ Reintentar actualización";
    updateBtn.title = u.error ?? "";
  }
  updateBtn.classList.toggle("hidden", u.phase === "al-dia" || u.phase === "buscando");
});
updateBtn.addEventListener("click", () => nexos.installUpdate());

$("btn-check-update").addEventListener("click", async () => {
  updateResult.className = "small inline";
  updateResult.textContent = "Buscando…";
  const u = await nexos.checkUpdates();
  if (u.phase === "disponible") {
    updateResult.classList.add("ok");
    updateResult.textContent = `Hay una versión nueva (v${u.version}): pulsa el botón verde de arriba.`;
  } else if (u.phase === "al-dia") {
    updateResult.classList.add("ok");
    updateResult.textContent = "✔ Tienes la última versión.";
  } else {
    updateResult.classList.add("bad");
    updateResult.textContent = u.error ?? "No se pudo comprobar.";
  }
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
const repairBtn = $<HTMLButtonElement>("btn-repair");
const ICONS: Record<StepState, string> = { pendiente: "", activo: "", hecho: "✔", error: "✕" };

nexos.onPlayState((s) => {
  window.__estado = s;
  $("steps").classList.remove("hidden");
  // Mientras se prepara se ve la barra; al terminar, otra vez el estado del modpack
  $("pack-info").classList.toggle("hidden", s.phase === "preparando" || s.phase === "jugando");
  const list = $("steps-list");
  list.innerHTML = "";
  for (const step of s.steps) {
    const li = document.createElement("li");
    li.className = step.state;
    li.innerHTML = `<span class="icon">${ICONS[step.state]}</span><span></span>`;
    li.lastElementChild!.textContent = step.label;
    list.appendChild(li);
  }
  $("progress").classList.toggle("hidden", s.phase !== "preparando" && s.phase !== "jugando");
  $("progress-text").textContent = s.text;
  const fill = $("progress-fill");
  fill.style.width = s.percent === null ? (s.phase === "jugando" || s.phase === "terminado" ? "100%" : "0") : `${s.percent}%`;
  $("error-box").classList.toggle("hidden", s.phase !== "error");
  $("error-text").textContent = s.error ?? "";
  $("btn-log").classList.toggle("hidden", !s.canOpenLog);
  playBtn.disabled = s.phase === "preparando" || s.phase === "jugando";
  playBtn.textContent = s.phase === "preparando" ? "…" : s.phase === "jugando" ? "JUGANDO" : "JUGAR";
  repairBtn.disabled = s.phase === "preparando" || s.phase === "jugando";
  if (s.phase === "terminado") {
    $("pack-info").textContent = s.text;
    refreshInfoLater();
  }
});

let infoTimer: number | undefined;
/** Tras reparar o cerrar el juego se deja leer el mensaje unos segundos y luego vuelve el estado del modpack. */
function refreshInfoLater(): void {
  window.clearTimeout(infoTimer);
  infoTimer = window.setTimeout(refreshInfo, 6000);
}

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

async function repair(): Promise<void> {
  showView("jugar");
  playBtn.disabled = true;
  try {
    await nexos.repair();
  } catch (e) {
    $("steps").classList.remove("hidden");
    $("error-box").classList.remove("hidden");
    $("error-text").textContent = cleanError(e);
    playBtn.disabled = false;
  }
}

playBtn.addEventListener("click", play);
repairBtn.addEventListener("click", repair);
$("btn-retry").addEventListener("click", () => (window.__estado?.mode === "reparar" ? repair() : play()));
$("btn-log").addEventListener("click", () => nexos.openLog());

export {};
