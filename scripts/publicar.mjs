// Publica una version nueva del launcher en las Releases de GitHub (los launchers instalados se actualizan solos).
// Antes: subir "version" en package.json y hacer commit. Este script crea la etiqueta vX.Y.Z, la sube, compila y sube
// el instalador con latest.yml. El token sale del gestor de credenciales de Git (no se muestra ni se guarda).
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const { version } = JSON.parse(readFileSync("package.json", "utf-8"));
const tag = `v${version}`;
const git = (...args) => execFileSync("git", args, { encoding: "utf-8" }).trim();

if (git("status", "--porcelain", "--untracked-files=no")) {
  console.error("[X] Hay cambios sin commit: haz commit antes de publicar.");
  process.exit(1);
}
if (!git("tag", "--list", tag)) {
  git("tag", tag);
}
git("push", "-q", "origin", "main", tag);

const cred = execFileSync("git", ["credential", "fill"], { input: "protocol=https\nhost=github.com\n\n", encoding: "utf-8" });
const token = /^password=(.*)$/m.exec(cred)?.[1];
if (!token) {
  console.error("[X] No hay credenciales de GitHub en el gestor de Git (haz un git push a mano una vez).");
  process.exit(1);
}

// La Release se crea antes: si no, electron-builder sube varios archivos a la vez, cada subida crea "su" Release y
// quedan dos con la misma etiqueta (paso con la v0.3.0: latest.yml en una y el resto en otra).
const repo = "Ssebatiaan/Nexos-Launcher";
const headers = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "nexos-launcher" };
const existing = await fetch(`https://api.github.com/repos/${repo}/releases/tags/${tag}`, { headers });
if (existing.status === 404) {
  const created = await fetch(`https://api.github.com/repos/${repo}/releases`, {
    method: "POST",
    headers,
    body: JSON.stringify({ tag_name: tag, name: version, draft: false, prerelease: false }),
  });
  if (!created.ok) {
    console.error(`[X] No se pudo crear la Release ${tag}: HTTP ${created.status}`);
    process.exit(1);
  }
}

const build = spawnSync("npm", ["run", "build"], { stdio: "inherit", shell: true });
if (build.status !== 0) process.exit(build.status ?? 1);
const env = { ...process.env, GH_TOKEN: token };
const pub = spawnSync("npx", ["electron-builder", "--win", "--publish", "always"], { stdio: "inherit", shell: true, env });
if (pub.status !== 0) process.exit(pub.status ?? 1);
console.log(`[OK] Publicada la ${tag}: https://github.com/Ssebatiaan/Nexos-Launcher/releases/tag/${tag}`);
