// Recursively find all Markdown files under a directory (sorted, stable order).

import { readdir } from "node:fs/promises";
import { join } from "node:path";

export async function discover(dir) {
  const out = [];
  async function walk(d) {
    let entries = [];
    try {
      entries = await readdir(d, { withFileTypes: true });
    } catch {
      return; // missing dir → nothing to build
    }
    for (const e of entries) {
      const p = join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.name.endsWith(".md")) out.push(p);
    }
  }
  await walk(dir);
  return out.sort();
}
