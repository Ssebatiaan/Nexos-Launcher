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
  // Los errores de varias descargas vienen juntos en un AggregateError: se muestran los primeros y cuantos hay.
  const inner: unknown[] = (e as { errors?: unknown[] }).errors ?? [];
  if (inner.length) {
    const kinds = new Map<string, number>();
    for (const x of inner) {
      const msg = x instanceof Error ? `${x.name}: ${x.message}` : String(x);
      kinds.set(msg.replace(/[0-9a-f]{40}/g, "<hash>").slice(0, 160), (kinds.get(msg) ?? 0) + 1);
    }
    console.error(`${inner.length} descargas fallidas. Tipos:`);
    [...kinds.entries()].slice(0, 8).forEach(([k, n]) => console.error(`  x${n}  ${k}`));
    const first = inner[0] as { cause?: unknown; stack?: string };
    console.error("Primera:", first?.stack ?? first, first?.cause ?? "");
  }
  process.exit(1);
});
