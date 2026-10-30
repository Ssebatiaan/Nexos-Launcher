// Copia lo que no se compila (HTML, CSS e imagenes) a dist/renderer.
import { cpSync, mkdirSync } from "node:fs";

mkdirSync("dist/renderer", { recursive: true });
for (const file of ["index.html", "styles.css", "splash.html", "splash.css"]) {
  cpSync(`src/renderer/${file}`, `dist/renderer/${file}`);
}
cpSync("assets", "dist/renderer/assets", { recursive: true });
// Visor 3D de skins (skinview3d, MIT; incluye three.js)
mkdirSync("dist/renderer/lib", { recursive: true });
cpSync("node_modules/skinview3d/bundles/skinview3d.bundle.js", "dist/renderer/lib/skinview3d.bundle.js");
