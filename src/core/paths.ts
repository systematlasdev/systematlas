import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Resolve package-relative asset paths (renderer bundle, schemas, examples) the
// same way in dev (tsx over src/) and when published (bundled into dist/). We walk
// up from this module to the nearest package.json — the package root — so the
// `../../` vs `../` difference between src/ and dist/ layouts stops mattering.
let cached: string | null = null;
function pkgRoot(): string {
  if (cached) return cached;
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, "package.json"))) {
      cached = dir;
      return dir;
    }
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  cached = dir;
  return dir;
}

/** Absolute path to an asset shipped with the package (e.g. pkgPath("schema","flow.schema.json")). */
export function pkgPath(...segments: string[]): string {
  return join(pkgRoot(), ...segments);
}
