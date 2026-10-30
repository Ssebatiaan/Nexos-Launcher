// Puente seguro entre la interfaz y el proceso principal: solo expone estas funciones (la interfaz no tiene Node).
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("nexos", {
  minimize: () => ipcRenderer.send("ventana:minimizar"),
  close: () => ipcRenderer.send("ventana:cerrar"),
  openDiscord: () => ipcRenderer.send("abrir:discord"),
  readOptions: () => ipcRenderer.invoke("opciones:leer"),
  saveOptions: (options: { ramMb: number }) => ipcRenderer.invoke("opciones:guardar", options),
  version: () => ipcRenderer.invoke("app:version"),
  syncPack: () => ipcRenderer.invoke("pack:sincronizar"),
  onPackProgress: (cb: (p: unknown) => void) => {
    ipcRenderer.removeAllListeners("pack:progreso");
    ipcRenderer.on("pack:progreso", (_e, p) => cb(p));
  },
});
