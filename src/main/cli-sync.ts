// Prueba de la sincronizacion sin abrir el launcher:
//   node dist/main/cli-sync.js <pack.json: URL o ruta> <carpeta del juego>
import { fetchPack, syncPack } from "./pack";

async function main(): Promise<void> {
  const [source, gameDir] = process.argv.slice(2);
  if (!source || !gameDir) {
    console.log("Uso: node dist/main/cli-sync.js <pack.json> <carpeta del juego>");
    process.exit(1);
  }
  const started = Date.now();
  const pack = await fetchPack(source);
  console.log(`Modpack ${pack.name} ${pack.version} (Minecraft ${pack.minecraft}, NeoForge ${pack.neoforge}): ${pack.files.length} archivos`);
  let lastLine = 0;
  const result = await syncPack(pack, gameDir, (p) => {
    const now = Date.now();
    if (now - lastLine > 1000 || p.phase === "listo") {
      lastLine = now;
      const mb = (n: number) => (n / 1e6).toFixed(1);
      console.log(p.phase === "descargando" ? `  descargando ${p.done}/${p.total} · ${mb(p.bytesDone)}/${mb(p.bytesTotal)} MB` : `  ${p.phase} ${p.done}/${p.total}`);
    }
  });
  console.log(`Listo en ${((Date.now() - started) / 1000).toFixed(1)} s: ${result.downloaded} descargados, ${result.removed} borrados, ${result.unchanged} sin cambios`);
}

main().catch((e) => {
  console.error("ERROR:", e instanceof Error ? e.message : e);
  process.exit(1);
});
