// Tras npm install: algunos paquetes de @xmcl se publicaron sin aplicar su "publishConfig" (npm no lo aplica, pnpm si)
// y su "main" apunta al codigo fuente (index.ts) en vez de a dist/. Se corrige con los valores de publishConfig.
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const scope = join("node_modules", "@xmcl");
if (existsSync(scope)) {
  for (const name of readdirSync(scope)) {
    const file = join(scope, name, "package.json");
    if (!existsSync(file)) continue;
    const pkg = JSON.parse(readFileSync(file, "utf-8"));
    if (String(pkg.main).endsWith(".ts") && pkg.publishConfig?.main) {
      for (const key of ["main", "module", "types", "typings", "exports"]) {
        if (pkg.publishConfig[key] !== undefined) pkg[key] = pkg.publishConfig[key];
      }
      writeFileSync(file, JSON.stringify(pkg, null, 2));
      console.log(`[fix-deps] @xmcl/${name}: main -> ${pkg.main}`);
    }
  }
}
