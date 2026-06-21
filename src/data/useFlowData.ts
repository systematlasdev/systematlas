import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type Doc, docKind } from "../model";
import type { FlowDocument } from "../core/types";
import { getSource, type DocMeta, type McpStatus, type McpSetupResult, type McpSchema, type DirListing, type BuildResult } from "./source";

export interface FlowData {
  flows: DocMeta[];
  /** Project display name (from the manifest, else the folder name). */
  projectName: string;
  /** Absolute project root (serve mode); "" in static build. For agent prompts. */
  projectRoot: string;
  /** Whether file mutations are available (serve mode only). */
  canWrite: boolean;
  /** Recently-opened project paths (serve mode). */
  recents: string[];
  /** Hierarchical drill-down path of document ids (root → current). */
  trail: string[];
  /** Currently shown document = trail tail. */
  activeId: string | null;
  /** Jump to a document (sidebar): resets the drill-down trail to its full path. */
  navigate: (id: string) => void;
  /** Drill into a sub-flow / trace: pushes the child onto the trail. */
  drillTo: (id: string) => void;
  /** Breadcrumb click: truncate the trail back to depth index. */
  goToDepth: (index: number) => void;
  // --- writes (serve only; no-ops otherwise) ---
  rename: (id: string, title: string) => Promise<void>;
  setCategory: (id: string, category: string) => Promise<void>;
  renameCategory: (from: string, to: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  openProject: (path: string) => Promise<void>;
  /** Open the OS folder dialog (serve only); resolves to a path or null. */
  pickFolder: () => Promise<string | null>;
  /** List subdirectories for the in-browser folder picker (serve only). */
  listDir: (path?: string) => Promise<DirListing>;
  /** child doc id → parent doc id (drill-down lineage), for sidebar indicators. */
  parents: Record<string, string>;
  /** MCP onboarding state (serve only; null otherwise). */
  mcp: McpStatus | null;
  setupMcp: (location: string, schema: McpSchema, dryRun?: boolean) => Promise<McpSetupResult>;
  /** Export the whole workspace as one self-contained HTML (serve only). */
  build: () => Promise<BuildResult>;
  /** Reveal a file/folder in the OS file manager (serve only). */
  reveal: (target: string) => Promise<void>;
  doc: Doc | null;
  error: string | null;
  /** Whether live updates are available (serve mode). */
  live: boolean;
}

/** Loads the project document list + the active doc, and subscribes to live updates. */
export function useFlowData(): FlowData {
  const source = useMemo(() => getSource(), []);
  const [flows, setFlows] = useState<DocMeta[]>([]);
  const [projectName, setProjectName] = useState<string>("");
  const [projectRoot, setProjectRoot] = useState<string>("");
  const [recents, setRecents] = useState<string[]>([]);
  // The drill-down trail is the single source of truth for navigation; the
  // active doc is its tail. Sidebar jumps reset it; drill-down pushes onto it.
  const [trail, setTrail] = useState<string[]>([]);
  const activeId = trail.length ? trail[trail.length - 1] : null;
  const [doc, setDoc] = useState<Doc | null>(null);
  const [error, setError] = useState<string | null>(null);

  // child doc id → parent doc id (who drills into it), across the workspace.
  // Lets a sidebar jump to a sub-flow/trace show its full path, as if drilled into.
  // Only Flow documents declare drill targets (node/edge subflow + trace).
  const parentsRef = useRef<Map<string, string>>(new Map());
  // Same map, exposed to the sidebar to show drill-down lineage (child → parent).
  const [parents, setParents] = useState<Record<string, string>>({});
  useEffect(() => {
    let alive = true;
    source
      .readAll()
      .then((docs) => {
        if (!alive) return;
        const m = new Map<string, string>();
        for (const d of docs) {
          if (docKind(d) !== "flow") continue;
          const f = d as FlowDocument;
          for (const n of f.nodes) {
            if (n.type === "subflow" && n.subflow && !m.has(n.subflow)) m.set(n.subflow, f.id);
            if (n.sequence && !m.has(n.sequence)) m.set(n.sequence, f.id);
          }
          for (const e of f.edges) {
            if (e.subflow && !m.has(e.subflow)) m.set(e.subflow, f.id);
            if (e.sequence && !m.has(e.sequence)) m.set(e.sequence, f.id);
          }
        }
        parentsRef.current = m;
        setParents(Object.fromEntries(m));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [source, flows.length]);

  // Full root→id path by walking the parent map (cycle-guarded).
  const pathTo = (id: string): string[] => {
    const path = [id];
    const seen = new Set([id]);
    let p = parentsRef.current.get(id);
    while (p && !seen.has(p)) {
      path.unshift(p);
      seen.add(p);
      p = parentsRef.current.get(p);
    }
    return path;
  };

  // Stable identities so consumers (e.g. buildGraph memo) don't recompute each render.
  const navigate = useCallback((id: string) => setTrail(pathTo(id)), []);
  const drillTo = useCallback(
    (id: string) => setTrail((t) => (t[t.length - 1] === id ? t : [...t, id])),
    [],
  );
  const goToDepth = useCallback((index: number) => setTrail((t) => t.slice(0, index + 1)), []);

  // Keep a ref to the active id so the (once-only) subscription can read the
  // current value without re-subscribing on every switch.
  const activeRef = useRef<string | null>(null);
  activeRef.current = activeId;

  // Apply a fresh project listing: refresh flows/name and keep the trail valid
  // (a deleted active doc falls back to the first available one).
  const applyProject = useCallback((name: string, root: string, docs: DocMeta[]) => {
    setProjectName(name);
    setProjectRoot(root);
    setFlows(docs);
    setError(null);
    const ids = new Set(docs.map((d) => d.id));
    setTrail((t) => {
      const trimmed = t.filter((id) => ids.has(id));
      if (trimmed.length) return trimmed.length === t.length ? t : trimmed;
      return docs[0] ? [docs[0].id] : [];
    });
  }, []);

  // Initial project listing.
  useEffect(() => {
    let alive = true;
    source
      .project()
      .then((p) => alive && applyProject(p.name, p.root, p.documents))
      .catch((e) => alive && setError(String(e)));
    return () => {
      alive = false;
    };
  }, [source, applyProject]);

  // Recents (serve only).
  const refreshRecents = useCallback(() => {
    source.writes?.recents().then(setRecents).catch(() => undefined);
  }, [source]);
  useEffect(refreshRecents, [refreshRecents]);

  // MCP onboarding status (serve only).
  const [mcp, setMcp] = useState<McpStatus | null>(null);
  const refreshMcp = useCallback(() => {
    source.writes?.mcpStatus().then(setMcp).catch(() => undefined);
  }, [source]);
  useEffect(refreshMcp, [refreshMcp]);
  const setupMcp = useCallback(
    async (location: string, schema: McpSchema, dryRun?: boolean) => {
      const r = await (source.writes?.setupMcp(location, schema, dryRun) ?? Promise.reject(new Error("not available")));
      if (!dryRun) refreshMcp();
      return r;
    },
    [source, refreshMcp],
  );
  const build = useCallback(
    () => source.writes?.build() ?? Promise.reject(new Error("not available")),
    [source],
  );
  const reveal = useCallback(
    (target: string) => source.writes?.reveal(target) ?? Promise.resolve(),
    [source],
  );

  // Load the active flow whenever it changes.
  useEffect(() => {
    if (!activeId) {
      setDoc(null);
      return;
    }
    let alive = true;
    setError(null);
    source
      .read(activeId)
      .then((d) => alive && setDoc(d))
      .catch((e) => {
        if (alive) {
          setError(String(e));
          setDoc(null);
        }
      });
    return () => {
      alive = false;
    };
  }, [source, activeId]);

  // Live updates (serve mode): replace the doc in place if it's the active one;
  // refetch the listing on project changes (add/rename/category/delete/switch).
  useEffect(() => {
    if (!source.subscribe) return;
    return source.subscribe({
      onUpdate: (id, d) => {
        if (id === activeRef.current) setDoc(d);
        const meta: DocMeta = { id, title: d.title, kind: docKind(d), category: "" };
        setFlows((fs) =>
          fs.some((f) => f.id === id)
            ? fs.map((f) => (f.id === id ? { ...meta, category: f.category } : f))
            : [...fs, meta],
        );
        setError(null);
      },
      onError: (msg) => setError(msg),
      onProjectChanged: () => {
        source
          .project()
          .then((p) => applyProject(p.name, p.root, p.documents))
          .catch((e) => setError(String(e)));
      },
    });
  }, [source, applyProject]);

  // --- write actions (rely on the project-changed SSE to refresh the listing) ---
  const rename = useCallback(
    (id: string, title: string) => source.writes?.rename(id, title) ?? Promise.resolve(),
    [source],
  );
  const setCategory = useCallback(
    (id: string, category: string) => source.writes?.setCategory(id, category) ?? Promise.resolve(),
    [source],
  );
  const renameCategory = useCallback(
    (from: string, to: string) => source.writes?.renameCategory(from, to) ?? Promise.resolve(),
    [source],
  );
  const pickFolder = useCallback(
    () => source.writes?.pickFolder() ?? Promise.resolve(null),
    [source],
  );
  const listDir = useCallback(
    (path?: string) => source.writes?.listDir(path) ?? Promise.reject(new Error("not available")),
    [source],
  );
  const remove = useCallback(
    (id: string) => source.writes?.remove(id) ?? Promise.resolve(),
    [source],
  );
  const openProject = useCallback(
    async (path: string) => {
      if (!source.writes) return;
      const p = await source.writes.openProject(path);
      setTrail([]); // jump cleanly into the new project
      applyProject(p.name, p.root, p.documents);
      refreshRecents();
      refreshMcp();
    },
    [source, applyProject, refreshRecents, refreshMcp],
  );

  return {
    flows,
    projectName,
    projectRoot,
    canWrite: !!source.writes,
    recents,
    trail,
    activeId,
    navigate,
    drillTo,
    goToDepth,
    rename,
    setCategory,
    renameCategory,
    remove,
    openProject,
    pickFolder,
    listDir,
    parents,
    mcp,
    setupMcp,
    build,
    reveal,
    doc,
    error,
    live: !!source.subscribe,
  };
}
