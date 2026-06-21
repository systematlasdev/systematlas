// Emit sitemap.xml from the built pages. Reuses resolveLink to make absolute URLs.

import { writeFile, mkdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { resolveLink } from "./html.js";

export async function writeSitemap(cfg, pages) {
  const urls = pages.map((p) => resolveLink(relative(cfg.outDir, p.outFile).replace(/\\/g, "/"), cfg.baseUrl));
  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.map((u) => `  <url><loc>${u}</loc></url>`).join("\n") +
    `\n</urlset>\n`;
  await mkdir(cfg.outDir, { recursive: true });
  await writeFile(join(cfg.outDir, "sitemap.xml"), xml, "utf8");
  return urls.length;
}
