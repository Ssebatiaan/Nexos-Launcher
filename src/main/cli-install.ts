// Prueba de la instalacion sin abrir el launcher:
//   node dist/main/cli-install.js <carpeta del launcher> [minecraft] [neoforge]
import { ensureJava, ensureMinecraft, ensureNeoForge, pathsFor, type StepProgress } from "./installer";

async function main(): Promise<void> {
  const [root, minecraft = "1.21.1", neoforge = "21.1.259"] = process.argv.slice(2);
  if (!root) {
    console.log("Uso: node dist/main/cli-install.js <carpeta> [minecraft] [neoforge]");
    process.exit(1);
  }
  const paths = pathsFor(root);
  let last = 0;
  const progress = (p: StepProgress) => {
    if (Date.now() - last > 2000) {
      last = Date.now();
      console.log(`  ${p.label}: ${(p.bytesDone / 1e6).toFixed(1)} / ${(p.bytesTotal / 1e6).toFixed(1)} MB`);
    }
  };
  const t = (start: number) => ((Date.now() - start) / 1000).toFixed(1) + " s";
  let start = Date.now();
  const java = await ensureJava(paths, 21, progress);
  console.log(`Java listo (${t(start)}): ${java}`);
  start = Date.now();
  await ensureMinecraft(paths, minecraft, progress);
  console.log(`Minecraft ${minecraft} listo (${t(start)})`);
  start = Date.now();
  const id = await ensureNeoForge(paths, neoforge, java, progress);
  console.log(`NeoForge listo (${t(start)}): version ${id}`);
}

main().catch((e) => {
  console.error("ERROR:", e instanceof Error ? e.stack ?? e.message : e);
  process.exit(1);
});
