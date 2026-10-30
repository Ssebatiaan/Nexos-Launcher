// Ventana del arranque: muestra lo que manda el proceso principal mientras busca o instala la version nueva.
interface SplashUpdate {
  phase: string;
  version?: string;
  percent?: number;
}

const api = (window as unknown as { nexos: { onUpdateState(cb: (s: SplashUpdate) => void): void } }).nexos;
const text = document.getElementById("text")!;
const sub = document.getElementById("sub")!;
const fill = document.getElementById("fill")!;

api.onUpdateState((u) => {
  if (u.phase === "descargando") {
    text.textContent = `Descargando la versión ${u.version}…`;
    sub.textContent = `${u.percent ?? 0} %`;
    fill.classList.add("known");
    fill.style.width = `${u.percent ?? 0}%`;
  } else if (u.phase === "instalando") {
    text.textContent = "Instalando la actualización…";
    sub.textContent = "El launcher se abrirá solo en unos segundos.";
    fill.classList.add("known");
    fill.style.width = "100%";
  } else if (u.phase === "al-dia") {
    text.textContent = "Todo al día. Abriendo…";
  }
});

export {};
