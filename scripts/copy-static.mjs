// Copia lo que no se compila (HTML, CSS e imagenes) a dist/renderer.
import { cpSync, mkdirSync } from "node:fs";

mkdirSync("dist/renderer", { recursive: true });
cpSync("src/renderer/index.html", "dist/renderer/index.html");
cpSync("src/renderer/styles.css", "dist/renderer/styles.css");
cpSync("assets", "dist/renderer/assets", { recursive: true });
