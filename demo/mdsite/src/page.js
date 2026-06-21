// Per-page pipeline: read → parse frontmatter → render Markdown → apply layout → write.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join, relative, basename } from "node:path";
import { renderMarkdown } from "./markdown.js";
import { escapeHtml } from "./html.js";

/** Pull a minimal `--- key: value ---` frontmatter block off the top. */
export function parseFrontmatter(raw) {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return { data: {}, body: raw };
  const data = {};
  for (const line of m[1].split("\n")) {
    const i = line.indexOf(":");
    if (i < 0) continue;
    data[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return { data, body: raw.slice(m[0].length) };
}

/** Wrap rendered body HTML in the page layout. Escapes the titles. */
export function applyLayout(cfg, title, bodyHtml) {
  return (
    `<!doctype html>\n` +
    `<html lang="en"><head><meta charset="utf-8">\n` +
    `<title>${escapeHtml(title)} · ${escapeHtml(cfg.title)}</title>\n` +
    `<link rel="stylesheet" href="${cfg.baseUrl.replace(/\/?$/, "/")}assets/style.css"></head>\n` +
    `<body><main>\n${bodyHtml}\n</main></body></html>\n`
  );
}

/** Build one Markdown file into one HTML file; returns its metadata. */
export async function buildPage(cfg, srcFile) {
  const raw = await readFile(srcFile, "utf8");
  const { data, body } = parseFrontmatter(raw);
  const title = data.title ?? basename(srcFile, ".md");
  const bodyHtml = renderMarkdown(body, cfg.baseUrl);
  const html = applyLayout(cfg, title, bodyHtml);
  const rel = relative(cfg.srcDir, srcFile).replace(/\.md$/, ".html");
  const outFile = join(cfg.outDir, rel);
  await mkdir(dirname(outFile), { recursive: true });
  await writeFile(outFile, html, "utf8");
  return { srcFile, outFile, title };
}
