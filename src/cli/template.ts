import { readFileSync } from "node:fs";
import { pkgPath } from "../core/paths";

// The pre-built self-contained renderer bundle (vite --mode singlefile). Both
// `serve` (serves it) and `build` (injects flow JSON into it) consume this.
export function readTemplate(): string {
  try {
    return readFileSync(pkgPath("dist-renderer", "index.html"), "utf8");
  } catch {
    throw new Error("Renderer bundle not found (dist-renderer/index.html). Run: npm run build:renderer");
  }
}
