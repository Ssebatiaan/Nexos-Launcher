// Puente seguro entre la interfaz y el proceso principal: solo expone estas funciones (la interfaz no tiene Node).
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("nexos", {
  minimize: () => ipcRenderer.send("ventana:minimizar"),
  close: () => ipcRenderer.send("ventana:cerrar"),
  openDiscord: () => ipcRenderer.send("abrir:discord"),
  openLog: () => ipcRenderer.send("abrir:registro"),
  readOptions: () => ipcRenderer.invoke("opciones:leer"),
  saveOptions: (options: { ramMb: number }) => ipcRenderer.invoke("opciones:guardar", options),
  version: () => ipcRenderer.invoke("app:version"),
  systemInfo: () => ipcRenderer.invoke("sistema:info"),
  listAccounts: () => ipcRenderer.invoke("cuentas:listar"),
  addOfflineAccount: (name: string) => ipcRenderer.invoke("cuentas:anadir", name),
  selectAccount: (id: string) => ipcRenderer.invoke("cuentas:elegir", id),
  removeAccount: (id: string) => ipcRenderer.invoke("cuentas:borrar", id),
  play: () => ipcRenderer.invoke("juego:jugar"),
  onPlayState: (cb: (s: unknown) => void) => {
    ipcRenderer.removeAllListeners("juego:estado");
    ipcRenderer.on("juego:estado", (_e, s) => cb(s));
  },
});
