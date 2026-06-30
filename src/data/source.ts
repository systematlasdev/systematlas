// Runtime data source for the renderer. The SAME renderer reads its JSON from one
// of three auto-detected sources (docs/concepts.md §10):
//   - embedded  → window.__FLOWTRACE__ injected by `flow-trace build`
//   - serve     → fetch + SSE from the `flow-trace serve` dev server
//   - dev       → bundled examples (vite dev, import.meta.env.DEV)
// A document is a Flow or a Sequence (discriminated by `kind`).
//
// Only `serve` carries a Node backend, so only it exposes project writes
// (rename/category/delete/open-project) — embedded & dev are read-only snapshots.
import { type Doc, type DocKind, docKind } from "../model";
import { BRAND } from "../brand";
import txn from "../../examples/transaction-create.flow.json";
import txnSeq from "../../examples/transaction-create-seq.sequence.json";
import refund from "../../examples/refund.flow.json";
import paymentCharge from "../../examples/payment-charge.flow.json";
import chargeSequence from "../../examples/charge-sequence.sequence.json";
import checkoutSequence from "../../examples/checkout-sequence.sequence.json";

export interface DocMeta {
  id: string;
  title: string;
  kind: DocKind;
  /** Logical, possibly-nested category ("a/b"). "" = ungrouped. */
  category: string;
}

export interface ProjectInfo {
  name: string;
  root: string;
  documents: DocMeta[];
}

/** Live-update event handlers (serve only). */
export interface LiveHandlers {
  onUpdate: (id: string, doc: Doc) => void;
  onError: (msg: string) => void;
  /** A document was added/renamed/recategorised/deleted, or the project switched. */
  onProjectChanged?: () => void;
  /** A NEW document file appeared on disk → show it (auto-open the new graph). */
  onDocAdded?: (id: string, doc: Doc) => void;
}

/** MCP onboarding (serve-only). */
export interface McpSchema {
  format: "json" | "toml";
  key: string;
}
export interface McpAgent {
  id: string;
  label: string;
  location: string;
  schema: McpSchema;
  /** Footprint detected on this machine/project. */
  present: boolean;
  /** false → shared/OS config: offer Copy, don't auto-write. */
  writable: boolean;
  /** This agent's config already declares flow-trace. */
  configured: boolean;
  /** The app rewrites its own config on exit → connect while it is closed. */
  guiManaged: boolean;
}

export interface DirListing {
  path: string;
  parent: string | null;
  dirs: string[];
}
export interface McpStatus {
  configured: boolean;
  path?: string;
  agents: McpAgent[];
}
export interface McpSetupResult {
  status: "written" | "merged" | "already" | "conflict";
  path: string;
  snippet: string;
}
export interface BuildResult {
  /** Absolute path of the generated self-contained HTML. */
  path: string;
  /** How many documents were embedded. */
  files: number;
}

/** Mutations — present only in serve mode (the file-access backend). */
export interface ProjectWrites {
  save(doc: Doc): Promise<void>;
  rename(id: string, title: string): Promise<void>;
  setCategory(id: string, category: string): Promise<void>;
  renameCategory(from: string, to: string): Promise<void>;
  remove(id: string): Promise<void>;
  openProject(path: string): Promise<ProjectInfo>;
  recents(): Promise<string[]>;
  /** Open the OS folder dialog (serve runs locally); resolves to a path or null. */
  pickFolder(): Promise<string | null>;
  /** List subdirectories of `path` (or the project root) for the in-browser picker. */
  listDir(path?: string): Promise<DirListing>;
  /** Is an agent already wired up here? + detected agents / locations. */
  mcpStatus(): Promise<McpStatus>;
  /** Write/merge an MCP config so an agent can author here (dryRun → snippet only). */
  setupMcp(location: string, schema: McpSchema, dryRun?: boolean): Promise<McpSetupResult>;
  /** Build a self-contained HTML of the whole workspace; returns the output path. */
  build(): Promise<BuildResult>;
  /** Reveal a file/folder in the OS file manager (serve runs locally). */
  reveal(target: string): Promise<void>;
}

export interface FlowSource {
  /** Project listing: name + documents (with categories). */
  project(): Promise<ProjectInfo>;
  list(): Promise<DocMeta[]>;
  read(id: string): Promise<Doc>;
  /** All documents — used to derive the sub-flow/trace parent map (breadcrumb path). */
  readAll(): Promise<Doc[]>;
  /** Live updates (serve only). Returns an unsubscribe fn. */
  subscribe?(handlers: LiveHandlers): () => void;
  /** File mutations (serve only). */
  writes?: ProjectWrites;
}

// Build-time injected global (name from BRAND.globalVar), read dynamically.
// `categories` (id → category) is baked by `build` so the static sidebar groups like
// serve; absent in older builds / single-file builds (then everything is ungrouped).
type EmbeddedData = { flows: Record<string, Doc>; categories?: Record<string, string> };
function embeddedData(): EmbeddedData | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as Record<string, EmbeddedData | undefined>)[BRAND.globalVar];
}

function metaOf(docs: Doc[], categories?: Record<string, string>): DocMeta[] {
  return docs.map((d) => ({ id: d.id, title: d.title, kind: docKind(d), category: categories?.[d.id] ?? "" }));
}

// --- embedded (build output) + dev share the read-only listing -----------------
function readOnlySource(flows: Record<string, Doc>, name: string, categories?: Record<string, string>): FlowSource {
  const docs = () => Object.values(flows);
  return {
    async project() {
      return { name, root: "", documents: metaOf(docs(), categories) };
    },
    async list() {
      return metaOf(docs(), categories);
    },
    async read(id) {
      const doc = flows[id];
      if (!doc) throw new Error(`No embedded document "${id}"`);
      return doc;
    },
    async readAll() {
      return docs();
    },
  };
}

// --- dev (vite dev: bundled examples) ------------------------------------------
function devSource(): FlowSource {
  const docs = [txn, txnSeq, refund, paymentCharge, chargeSequence, checkoutSequence] as unknown as Doc[];
  const flows: Record<string, Doc> = {};
  for (const d of docs) flows[d.id] = d;
  return readOnlySource(flows, "Examples");
}

// --- serve (our dev server: fetch + SSE) ---------------------------------------
function serveSource(): FlowSource {
  const getJson = async <T>(url: string): Promise<T> => {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${url} ${r.status}`);
    return (await r.json()) as T;
  };
  const send = async (url: string, method: string, body?: unknown): Promise<void> => {
    const r = await fetch(url, {
      method,
      headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!r.ok) {
      const err = await r.json().catch(() => null);
      throw new Error((err as { error?: string })?.error ?? `${url} ${r.status}`);
    }
  };
  return {
    project() {
      return getJson<ProjectInfo>("/api/project");
    },
    async list() {
      return (await getJson<ProjectInfo>("/api/project")).documents;
    },
    read(id) {
      return getJson<Doc>(`/api/flow/${encodeURIComponent(id)}`);
    },
    async readAll() {
      const { documents } = await getJson<ProjectInfo>("/api/project");
      return Promise.all(documents.map((m) => getJson<Doc>(`/api/flow/${encodeURIComponent(m.id)}`)));
    },
    subscribe({ onUpdate, onError, onProjectChanged, onDocAdded }) {
      const es = new EventSource("/api/events");
      es.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data) as
            | { type: "flow-updated"; id: string; doc: Doc }
            | { type: "doc-added"; id: string; doc: Doc }
            | { type: "project-changed" }
            | { type: "error"; message: string };
          if (msg.type === "flow-updated") onUpdate(msg.id, msg.doc);
          else if (msg.type === "doc-added") onDocAdded?.(msg.id, msg.doc);
          else if (msg.type === "project-changed") onProjectChanged?.();
          else if (msg.type === "error") onError(msg.message);
        } catch {
          /* ignore malformed event */
        }
      };
      return () => es.close();
    },
    writes: {
      save(doc) {
        return send(`/api/doc/${encodeURIComponent(doc.id)}`, "PUT", doc);
      },
      rename(id, title) {
        return send(`/api/doc/${encodeURIComponent(id)}/rename`, "POST", { title });
      },
      setCategory(id, category) {
        return send(`/api/doc/${encodeURIComponent(id)}/category`, "POST", { category });
      },
      renameCategory(from, to) {
        return send("/api/category/rename", "POST", { from, to });
      },
      remove(id) {
        return send(`/api/doc/${encodeURIComponent(id)}`, "DELETE");
      },
      async openProject(path) {
        const r = await fetch("/api/open-project", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path }),
        });
        const data = await r.json().catch(() => null);
        if (!r.ok) throw new Error((data as { error?: string })?.error ?? `open-project ${r.status}`);
        return data as ProjectInfo;
      },
      recents() {
        return getJson<string[]>("/api/recents");
      },
      async pickFolder() {
        const r = await fetch("/api/pick-folder", { method: "POST" });
        if (!r.ok) return null;
        return ((await r.json()) as { path: string | null }).path;
      },
      listDir(path) {
        return getJson<DirListing>(`/api/list-dir${path ? `?path=${encodeURIComponent(path)}` : ""}`);
      },
      mcpStatus() {
        return getJson<McpStatus>("/api/mcp-status");
      },
      async setupMcp(location, schema, dryRun) {
        const r = await fetch("/api/setup-mcp", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ location, schema, dryRun }),
        });
        const data = await r.json().catch(() => null);
        if (!r.ok) throw new Error((data as { error?: string })?.error ?? `setup-mcp ${r.status}`);
        return data as McpSetupResult;
      },
      async build() {
        const r = await fetch("/api/build", { method: "POST" });
        const data = await r.json().catch(() => null);
        if (!r.ok) throw new Error((data as { error?: string })?.error ?? `build ${r.status}`);
        return data as BuildResult;
      },
      reveal(target) {
        return send("/api/reveal", "POST", { path: target });
      },
    },
  };
}

export function getSource(): FlowSource {
  const data = embeddedData();
  if (data) {
    return readOnlySource(data.flows, BRAND.display, data.categories);
  }
  if (import.meta.env.DEV) return devSource();
  return serveSource();
}
