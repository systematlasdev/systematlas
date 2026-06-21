// Copy every non-Markdown file from the source tree into the output, preserving paths.

import { readdir, mkdir, copyFile } from "node:fs/promises";
import { join, relative, dirname } from "node:path";

export async function copyAssets(cfg) {
  const copied = [];
  async function walk(d) {
    let entries = [];
    try {
      entries = await readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(d, e.name);
      if (e.isDirectory()) {
        await walk(p);
      } else if (!e.name.endsWith(".md")) {
        const rel = relative(cfg.srcDir, p);
        const out = join(cfg.outDir, rel);
        await mkdir(dirname(out), { recursive: true });
        await copyFile(p, out);
        copied.push(rel);
      }
    }
  }
  await walk(cfg.srcDir);
  return copied;
}
