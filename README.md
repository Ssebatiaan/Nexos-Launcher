# Nexos Launcher

Launcher de **Nexos MC** (servidor RPG de Minecraft 1.21.1 con NeoForge). Objetivo: que cualquiera pueda jugar sin
instalar nada a mano.

- Instala lo necesario aunque no tengas Minecraft: Java 21, Minecraft 1.21.1, NeoForge y el modpack.
- Al abrir busca actualizaciones del modpack y del propio launcher (botón verde para actualizar y reiniciar).
- Cuentas premium (Microsoft) y no premium, guardadas cifradas.
- Opciones (memoria, etc.), botón de Discord, noticias y estado del servidor.
- Skins con visor 3D y subida de skin que se ve en el servidor.

## Desarrollo

Requisitos: Node.js 20 o más nuevo.

```bash
npm install
npm start          # compila y abre el launcher
npm run captura    # compila, abre, guarda captura.png y se cierra (para revisar el diseño)
```

Estructura:

- `src/main/` – proceso principal de Electron (ventana, archivos, enlaces). `preload.ts` expone a la interfaz solo
  las funciones de `window.nexos`.
- `src/renderer/` – interfaz (HTML, CSS y TypeScript, sin frameworks).
- `assets/` – logo y fondo (los mismos del menú del juego).
- `docs/` – notas, como pedir la aprobación de Microsoft para el modo premium.

## Plan por sprints

| Sprint | Contenido | Estado |
|---|---|---|
| 0 | Proyecto base con la estética de Nexos; pedir la aprobación de Microsoft | Hecho (falta la aprobación) |
| 1 | Distribución del modpack: lista de mods y configs con sus huellas, publicada | Pendiente |
| 2 | Instalar y jugar: Java 21 + Minecraft + NeoForge + modpack, cuenta no premium, entrar al servidor | Pendiente |
| 3 | Actualizaciones y opciones: buscar al abrir, auto-actualización del launcher, Discord, noticias, estado | Pendiente |
| 4 | Cuentas: varias guardadas, Microsoft (cuando aprueben la app) | Pendiente |
| 5 | Skins: visor 3D, subir skin y que se vea en el servidor | Pendiente |
| 6 | Pulido: instalador .exe, auto-login no premium, registro de errores | Pendiente |
