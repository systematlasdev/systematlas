import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { Project } from "../core/project";
import type { AnyDoc as WorkspaceDoc } from "../core/validate-doc";
import { readTemplate } from "./template";
import { BRAND } from "../brand";

const SUFFIX_RE = /\.(flow|sequence)\.json$/;

export interface BuildOptions {
  target?: string; // a single .flow.json / .sequence.json file, or a workspace dir (default cwd)
  out?: string;
  minify: boolean;
  /** Emit one HTML per document instead of a single bundled index.html (a whole-
   *  workspace build keeps cross-document drill-down working — the default). */
  split?: boolean;
}

/** Inject documents into the renderer template → a self-contained HTML.
 *  `flows` may hold one doc or the whole workspace (the latter keeps drill-down
 *  working, since drill targets must be present in the same page). */
function emit(dest: string, template: string, flows: Record<string, WorkspaceDoc>, minify: boolean): void {
  const payload = { flows };
  // Escape "<" so a "</script>" inside any string can't break out of the tag.
  const json = JSON.stringify(payload, null, minify ? undefined : 2).replace(/</g, "\\u003c");
  const script = `<script>window.${BRAND.globalVar}=${json}</script>`;
  const html = template.replace("</head>", `${script}\n</head>`);
  mkdirSync(path.dirname(dest), { recursive: true });
  writeFileSync(dest, html, "utf8");
  console.log(`Built ${dest}`);
}

export async function runBuild(opts: BuildOptions): Promise<void> {
  const template = readTemplate();

  if (opts.target && SUFFIX_RE.test(opts.target)) {
    const doc = JSON.parse(readFileSync(opts.target, "utf8")) as WorkspaceDoc;
    const dest = opts.out ? path.join(opts.out, `${doc.id}.html`) : path.join(path.dirname(path.resolve(opts.target)), `${doc.id}.html`);
    emit(dest, template, { [doc.id]: doc }, opts.minify);
    return;
  }

  const dir = path.resolve(opts.target ?? process.cwd());
  const docs = await new Project(dir).readAll();
  if (docs.length === 0) {
    console.error(`No *.flow.json / *.sequence.json files found in ${dir}`);
    process.exit(1);
  }
  const outDir = opts.out ?? path.join(dir, "dist");

  if (opts.split) {
    // One self-contained HTML per document (drill-down is disabled across files).
    for (const doc of docs) emit(path.join(outDir, `${doc.id}.html`), template, { [doc.id]: doc }, opts.minify);
    return;
  }

  // Default: one index.html embedding the WHOLE workspace → drill-down works.
  const flows = Object.fromEntries(docs.map((d) => [d.id, d]));
  emit(path.join(outDir, "index.html"), template, flows, opts.minify);
}
