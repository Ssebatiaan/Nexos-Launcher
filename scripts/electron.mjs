// Arranca Electron con los argumentos dados. Quita ELECTRON_RUN_AS_NODE, que la terminal de VS Code deja puesta y
// hace que Electron se comporte como Node puro (no abriria la ventana).
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const electron = createRequire(import.meta.url)("electron");
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, [".", ...process.argv.slice(2)], { stdio: "inherit", env });
child.on("exit", (code) => process.exit(code ?? 0));
