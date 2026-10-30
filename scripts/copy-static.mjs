// Copia lo que no se compila (HTML, CSS e imagenes) a dist/renderer.
import { cpSync, mkdirSync } from "node:fs";

mkdirSync("dist/renderer", { recursive: true });
for (const file of ["index.html", "styles.css", "splash.html", "splash.css"]) {
  cpSync(`src/renderer/${file}`, `dist/renderer/${file}`);
}
cpSync("assets", "dist/renderer/assets", { recursive: true });
