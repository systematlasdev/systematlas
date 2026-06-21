import { promises as fs } from "node:fs";
import path from "node:path";
import type { ValidationResult } from "./validate";
import { type AnyDoc, docKind, validateDoc } from "./validate-doc";
import { Workspace } from "./workspace";
import { BRAND, STORE_DIRS } from "../brand";

const MANIFEST = path.join(BRAND.storeDir, "project.json"); // canonical (write target)
const FLOW = ".flow.json";
const SEQUENCE = ".sequence.json";

export interface ManifestEntry {
  id: string;
  /** Path to the document file, relative to the project root (may point outside it). */
  path: string;
  /** Logical, possibly-nested category ("a/b"). Omitted = ungrouped. */
  category?: string;
}
export interface Manifest {
  version: string;
  name?: string;
  documents: ManifestEntry[];
}

export interface ProjectEntry {
  id: string;
  kind: "flow" | "sequence";
  title: string;
  category: string; // "" = ungrouped
}

const suffixFor = (doc: AnyDoc): string => (docKind(doc) === "sequence" ? SEQUENCE : FLOW);

/**
 * A flow-trace project: a folder with an optional `.flowtrace/project.json` manifest
 * that indexes documents ({id, path, category}) which may live at arbitrary paths.
 * No manifest → falls back to a flat scan of the folder (zero-config). The manifest
 * is auto-created when the project is first organized (category/new write).
 */
export class Project {
  constructor(public readonly root: string) {}

  private manifestFile(): string {
    return path.join(this.root, MANIFEST);
  }

  async loadManifest(): Promise<Manifest | null> {
    // Read the manifest from the current store dir, falling back to legacy dirs
    // so projects created before a rename still resolve.
    for (const dir of STORE_DIRS) {
      try {
        const m = JSON.parse(await fs.readFile(path.join(this.root, dir, "project.json"), "utf8")) as Manifest;
        if (Array.isArray(m?.documents)) return m;
      } catch {
        /* try next */
      }
    }
    return null;
  }

  async saveManifest(m: Manifest): Promise<void> {
    await fs.mkdir(path.dirname(this.manifestFile()), { recursive: true });
    await fs.writeFile(this.manifestFile(), JSON.stringify(m, null, 2) + "\n", "utf8");
  }

  /** Absolute file path for an id — from the manifest, else a flat scan fallback. */
  private async resolvePath(id: string, m?: Manifest | null): Promise<string | null> {
    const man = m !== undefined ? m : await this.loadManifest();
    const entry = man?.documents.find((d) => d.id === id);
    if (entry) return path.resolve(this.root, entry.path);
    // No manifest entry → scan the store dir(s) first, then the root.
    for (const base of [...STORE_DIRS.map((d) => path.join(this.root, d)), this.root]) {
      for (const sfx of [FLOW, SEQUENCE]) {
        const file = path.join(base, id + sfx);
        try {
          await fs.access(file);
          return file;
        } catch {
          /* next */
        }
      }
    }
    return null;
  }

  private async readFile(file: string): Promise<AnyDoc> {
    return JSON.parse(await fs.readFile(file, "utf8")) as AnyDoc;
  }

  async read(id: string): Promise<AnyDoc> {
    const file = await this.resolvePath(id);
    if (!file) throw new Error(`No document "${id}" in project`);
    return this.readFile(file);
  }

  /** All documents (parsed); skips missing/unparseable. */
  async readAll(): Promise<AnyDoc[]> {
    const m = await this.loadManifest();
    if (!m) return new Workspace(this.root).readAll();
    const out: AnyDoc[] = [];
    for (const e of m.documents) {
      try {
        out.push(await this.readFile(path.resolve(this.root, e.path)));
      } catch {
        /* skip */
      }
    }
    return out;
  }

  /** Listing for the sidebar: id + kind + title + category. */
  async entries(): Promise<ProjectEntry[]> {
    const m = await this.loadManifest();
    if (!m) {
      const docs = await new Workspace(this.root).readAll();
      return docs.map((d) => ({ id: d.id, kind: docKind(d), title: d.title, category: "" }));
    }
    const out: ProjectEntry[] = [];
    for (const e of m.documents) {
      try {
        const doc = await this.readFile(path.resolve(this.root, e.path));
        out.push({ id: doc.id, kind: docKind(doc), title: doc.title, category: e.category ?? "" });
      } catch {
        /* skip missing */
      }
    }
    return out;
  }

  async validate(doc: AnyDoc): Promise<ValidationResult> {
    return validateDoc(doc, await this.readAll());
  }

  /** Seed a manifest from a flat scan (when first organizing a zero-config folder). */
  private async ensureManifest(): Promise<Manifest> {
    const existing = await this.loadManifest();
    if (existing) return existing;
    const refs = await new Workspace(this.root).list();
    return { version: "1", documents: refs.map((r) => ({ id: r.id, path: r.rel })) };
  }

  /** Persist a document (caller validates). New documents are tucked under
   *  `.flowtrace/` (the server owns storage; the agent only ever passes a doc by
   *  id). Existing documents keep their recorded path. A manifest is created on
   *  first write; pre-existing flat files are indexed in place (not moved). */
  async write(doc: AnyDoc, opts?: { category?: string }): Promise<string> {
    const m = (await this.loadManifest()) ?? (await this.ensureManifest());
    return this.writeInto(m, doc, opts?.category);
  }

  private async writeInto(m: Manifest, doc: AnyDoc, category?: string): Promise<string> {
    let entry = m.documents.find((d) => d.id === doc.id);
    if (!entry) {
      // New documents live under the store dir to keep the project root clean.
      entry = { id: doc.id, path: `${BRAND.storeDir}/${doc.id}${suffixFor(doc)}`, category };
      m.documents.push(entry);
    } else if (category !== undefined) {
      entry.category = category;
    }
    const file = path.resolve(this.root, entry.path);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(doc, null, 2) + "\n", "utf8");
    await this.saveManifest(m);
    return file;
  }

  async setCategory(id: string, category: string): Promise<void> {
    const m = await this.ensureManifest();
    const entry = m.documents.find((d) => d.id === id);
    if (!entry) throw new Error(`No document "${id}" in project`);
    entry.category = category;
    await this.saveManifest(m);
  }

  /** Rename a category and everything nested under it (prefix rewrite).
   *  `to === ""` ungroups the affected documents. */
  async renameCategory(from: string, to: string): Promise<void> {
    const m = await this.ensureManifest();
    const rewrite = (c: string): string => {
      if (c !== from && !c.startsWith(from + "/")) return c;
      const suffix = c === from ? "" : c.slice(from.length + 1);
      return [to, suffix].filter(Boolean).join("/");
    };
    for (const e of m.documents) e.category = rewrite(e.category ?? "");
    await this.saveManifest(m);
  }

  /** Rename = change the display title (v1 keeps id stable to preserve drill refs). */
  async rename(id: string, title: string): Promise<void> {
    const doc = await this.read(id);
    (doc as { title: string }).title = title;
    await this.write(doc);
  }

  async remove(id: string): Promise<void> {
    const file = await this.resolvePath(id);
    if (file) {
      try {
        await fs.unlink(file);
      } catch {
        /* already gone */
      }
    }
    const m = await this.loadManifest();
    if (m) {
      m.documents = m.documents.filter((d) => d.id !== id);
      await this.saveManifest(m);
    }
  }
}
