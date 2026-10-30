// Puente seguro entre la interfaz y el proceso principal: solo expone estas funciones (la interfaz no tiene Node).
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("nexos", {
  minimize: () => ipcRenderer.send("ventana:minimizar"),
  close: () => ipcRenderer.send("ventana:cerrar"),
  openDiscord: () => ipcRenderer.send("abrir:discord"),
  openLog: () => ipcRenderer.send("abrir:registro"),
  openFolder: () => ipcRenderer.send("abrir:carpeta"),
  readOptions: () => ipcRenderer.invoke("opciones:leer"),
  saveOptions: (options: Record<string, unknown>) => ipcRenderer.invoke("opciones:guardar", options),
  version: () => ipcRenderer.invoke("app:version"),
  info: () => ipcRenderer.invoke("app:info"),
  serverStatus: () => ipcRenderer.invoke("servidor:estado"),
  systemInfo: () => ipcRenderer.invoke("sistema:info"),
  listAccounts: () => ipcRenderer.invoke("cuentas:listar"),
  addOfflineAccount: (name: string) => ipcRenderer.invoke("cuentas:anadir", name),
  selectAccount: (id: string) => ipcRenderer.invoke("cuentas:elegir", id),
  removeAccount: (id: string) => ipcRenderer.invoke("cuentas:borrar", id),
  play: () => ipcRenderer.invoke("juego:jugar"),
  listSkins: () => ipcRenderer.invoke("skins:listar"),
  uploadSkin: (variant: string) => ipcRenderer.invoke("skins:subir", variant),
  premiumSkin: (name: string) => ipcRenderer.invoke("skins:premium", name),
  selectSkin: (id: string | null) => ipcRenderer.invoke("skins:elegir", id),
  setSkinVariant: (id: string, variant: string) => ipcRenderer.invoke("skins:variante", id, variant),
  removeSkin: (id: string) => ipcRenderer.invoke("skins:borrar", id),
  repair: () => ipcRenderer.invoke("juego:reparar"),
  checkUpdates: () => ipcRenderer.invoke("actualizar:buscar"),
  installUpdate: () => ipcRenderer.invoke("actualizar:instalar"),
  onUpdateState: (cb: (s: unknown) => void) => {
    ipcRenderer.removeAllListeners("actualizar:estado");
    ipcRenderer.on("actualizar:estado", (_e, s) => cb(s));
  },
  onPlayState: (cb: (s: unknown) => void) => {
    ipcRenderer.removeAllListeners("juego:estado");
    ipcRenderer.on("juego:estado", (_e, s) => cb(s));
  },
});
