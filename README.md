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
npm run captura    # compila, abre, guarda captura.png y se cierra (NEXOS_VISTA=opciones: otra pantalla)
npm run dist       # instalador en release/ (sin publicar)
```

Estructura:

- `src/main/` – proceso principal de Electron (ventana, archivos, enlaces). `preload.ts` expone a la interfaz solo
  las funciones de `window.nexos`.
- `src/renderer/` – interfaz (HTML, CSS y TypeScript, sin frameworks).
- `assets/` – logo y fondo (los mismos del menú del juego).
- `docs/` – notas, como pedir la aprobación de Microsoft para el modo premium.

## Modpack

El launcher lee `https://raw.githubusercontent.com/Ssebatiaan/Nexos-Launcher/pack/pack.json` (rama `pack`, la genera
y publica `tools/build_launcher_pack.py --publicar` del proyecto del servidor). Cada archivo de la carpeta del juego
lleva su descarga (Modrinth, CurseForge o la propia rama) y su SHA-1. `src/main/pack.ts` baja lo que falta o cambió,
borra lo que se quitó del paquete y no toca los mods que añada el jugador.

```bash
node dist/main/cli-sync.js <pack.json> <carpeta>   # probar la sincronización sin abrir la ventana
NEXOS_PACK_URL=<ruta o URL> npm start                # usar otra lista (pruebas)
```

## Instalar y jugar

Al pulsar JUGAR (`src/main/main.ts`) se comprueba y, si falta, se instala cada paso con su icono en la interfaz:

1. **Java 21**: el runtime oficial de Mojang (`installer.ts`, `ensureJava`), en `%APPDATA%/Nexos Launcher/java`.
2. **Minecraft 1.21.1** y **NeoForge** (`ensureMinecraft`, `ensureNeoForge`, con `@xmcl/installer`), en `minecraft/`.
   Las descargas usan 16 conexiones y se repiten hasta 4 veces: solo baja lo que falta o está dañado.
3. **Modpack** (`pack.ts`), en `juego/`.
4. **Abrir el juego** (`game.ts`, `@xmcl/core`) con la cuenta elegida, en el menú principal (se entra con "Jugar en Nexos MC").
   Lo que escribe el juego va a `registros/juego.log` (pasado a texto por `gamelog.ts`); si se cierra con error,
   la interfaz ofrece "Ver registro".

Cuentas no premium en `cuentas.json` (`accounts.ts`): el UUID es el mismo que da el servidor
(`OfflinePlayer:<nombre>`), así que se conserva todo lo jugado. Pruebas sin ventana:

```bash
node dist/main/cli-install.js <carpeta>                 # Java + Minecraft + NeoForge
NEXOS_PRUEBA_JUGAR=1 node scripts/electron.mjs --captura=captura.png   # pulsa JUGAR solo y guarda la captura
```

Versiones fijadas: `@xmcl/installer` 6.1.2 y `@xmcl/core` 2.15.1 (las 6.3.x están mal publicadas en npm) y
`undici` 8.12.3 para todos (`overrides`): la 7.x tiene un fallo (`assert(!this.paused)`) que sacaba una ventana de error
al cerrar el servidor una descarga.

## Actualizaciones, estado y novedades

- **El launcher se actualiza solo** (`src/main/updater.ts`, electron-updater con las Releases de este repo). Al abrir, una
  ventanita (`splash.html`) busca versión nueva y, si la hay, la descarga, la instala y se vuelve a abrir (como Steam).
  Con el launcher abierto se mira cada 30 min: si sale una nueva aparece arriba el botón verde «Actualización lista».
  Solo en el launcher instalado (con `npm start` no; `NEXOS_PRUEBA_UPDATER=1` para probarlo).
- **Publicar una versión**: subir `version` en `package.json`, commit y `npm run publicar` (crea la etiqueta, compila
  el instalador `Nexos-Launcher-Setup-X.Y.Z.exe` y lo sube con `latest.yml`; el token sale del gestor de credenciales de
  Git). Sin firma digital: la primera instalación muestra «Windows protegió su PC» (Más información > Ejecutar de todas formas).
- **Estado del servidor** (`status.ts`): el mismo «ping» que la lista de servidores de Minecraft, cada 30 s.
- **Novedades**: el campo `news` de `pack.json` (en el proyecto del servidor, `client-pack/noticias.json`).
- **Opciones**: memoria, ventana del juego (tamaño o pantalla completa), qué hace el launcher al abrir el juego, Reparar
  instalación (vuelve a poner Java y revisa la huella de todos los archivos), abrir la carpeta del juego, buscar
  actualizaciones.

## Plan por sprints

| Sprint | Contenido | Estado |
|---|---|---|
| 0 | Proyecto base con la estética de Nexos; pedir la aprobación de Microsoft | Hecho (falta la aprobación) |
| 1 | Distribución del modpack: `pack.json` en la rama `pack`, sincronización con comprobación de huellas | Hecho |
| 2 | Instalar y jugar: Java 21 + Minecraft + NeoForge + modpack, cuenta no premium, entrar al servidor | Hecho |
| 3 | Actualizaciones y opciones: buscar al abrir, auto-actualización del launcher, Discord, noticias, estado | Hecho |
| 4 | Cuentas: varias guardadas, Microsoft (cuando aprueben la app) | Pendiente |
| 5 | Skins: visor 3D, subir skin y que se vea en el servidor | Pendiente |
| 6 | Pulido: instalador .exe, auto-login no premium, registro de errores | Pendiente |
