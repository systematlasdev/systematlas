import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import {
  Background,
  BackgroundVariant,
  getNodesBounds,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type Node,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  docKind,
  type Actor,
  type DrillOrigin,
  type FlowDocument,
  type FlowEdge,
  type FlowNode,
  type NodeData,
  type NodeType,
  type SequenceCall,
  type SequenceDocument,
} from "./model";
import { buildActorColors, NEUTRAL, type ActorColors } from "./theme";
import { buildGraph, DIMS, edgeKey } from "./layout";
import { nodeTypes } from "./nodes";
import { edgeTypes } from "./edges";
import { SequenceCanvas, flattenCalls } from "./sequence/SequenceCanvas";
import { SEQ, seqWidth } from "./sequence/geometry";
import { tokens } from "./tokens";
import { useFlowData } from "./data/useFlowData";
import type { McpStatus } from "./data/source";
import { BRAND } from "./brand";
import { TopBar, type Crumb } from "./shell/TopBar";
import { Sidebar } from "./shell/Sidebar";
import { OverviewBar } from "./shell/OverviewBar";
import { DetailPanel, type ActorView } from "./shell/DetailPanel";
import { ErrorBoundary } from "./shell/ErrorBoundary";
import { IconFitCorners, IconMinus, IconPlus } from "./shell/icons";

type Selection =
  | { kind: "node"; id: string }
  | { kind: "edge"; id: string }
  | { kind: "call"; id: string }
  | { kind: "actor"; id: string }
  | null;

function Legend({
  actors,
  colors,
  activeId,
  onSelect,
}: {
  actors: Actor[];
  colors: ActorColors;
  activeId: string | null;
  onSelect: (id: string) => void;
}) {
  if (actors.length === 0) return null;
  return (
    <div
      style={{
        background: "#FFFDF8",
        border: `1px solid ${tokens.color.border}`,
        borderRadius: 10,
        padding: "8px 8px 6px",
        boxShadow: "0 1px 3px rgba(0,0,0,.06)",
        fontSize: 12,
      }}
    >
      <div style={{ fontWeight: 700, margin: "0 4px 6px", color: "#4a463d" }}>Actors</div>
      {actors.map((a) => {
        const active = a.id === activeId;
        return (
          <button
            key={a.id}
            onClick={() => onSelect(a.id)}
            title={`Highlight all ${a.label} steps`}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 7,
              width: "100%",
              padding: "4px 6px",
              border: "none",
              borderRadius: 7,
              cursor: "pointer",
              fontFamily: "inherit",
              fontSize: 12,
              textAlign: "left",
              background: active ? `${colors[a.id]}22` : "transparent",
              color: "#4a463d",
              fontWeight: active ? 700 : 500,
            }}
          >
            <span style={{ width: 10, height: 10, borderRadius: 3, background: colors[a.id], display: "inline-block", flex: "0 0 auto" }} />
            {a.label}
          </button>
        );
      })}
    </div>
  );
}

function ZoomControls() {
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  const btn: React.CSSProperties = { width: 36, height: 34, borderBottom: `1px solid ${tokens.color.borderSoft}` };
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        background: "#FFFFFF",
        border: `1px solid ${tokens.color.border}`,
        borderRadius: 10,
        boxShadow: "0 2px 8px rgba(74,60,30,0.06)",
        overflow: "hidden",
      }}
    >
      <button className="ft-zoombtn" style={btn} title="Zoom in" onClick={() => zoomIn({ duration: 200 })}>
        <IconPlus size={16} />
      </button>
      <button className="ft-zoombtn" style={btn} title="Zoom out" onClick={() => zoomOut({ duration: 200 })}>
        <IconMinus size={16} />
      </button>
      <button className="ft-zoombtn" style={{ width: 36, height: 34 }} title="Fit to view" onClick={() => fitView({ duration: 300 })}>
        <IconFitCorners size={15} />
      </button>
    </div>
  );
}

function Banner({ text }: { text: string }) {
  return (
    <div
      style={{
        position: "absolute",
        top: 12,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 10,
        maxWidth: "70%",
        background: "#FBEAE7",
        border: "1px solid #E7B7AE",
        color: "#8C3B2B",
        borderRadius: 10,
        padding: "8px 14px",
        fontSize: 13,
        boxShadow: "0 2px 8px rgba(74,60,30,0.08)",
      }}
    >
      {text}
    </div>
  );
}

function Placeholder({ text }: { text: string }) {
  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: tokens.color.muted, fontSize: 14 }}>
      {text}
    </div>
  );
}

// Copy with a fallback for contexts where navigator.clipboard is unavailable
// (older webviews / non-secure origins): a hidden textarea + execCommand.
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

// Empty-state coaching for an open project with no documents. Branches on MCP
// status: not wired up → "connect an agent"; wired up → "ask your agent", with a
// copyable starter prompt that names the project path (so a global client like
// Claude Desktop gets `workspace` for free).
function EmptyState({ mcp, projectRoot }: { mcp: McpStatus | null; projectRoot: string }) {
  const [copied, setCopied] = useState(false);
  const wrap = (children: ReactNode) => (
    <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ maxWidth: 480, textAlign: "center", display: "flex", flexDirection: "column", gap: 10 }}>{children}</div>
    </div>
  );
  const title = (t: string) => <div style={{ fontSize: 16, fontWeight: 700, color: tokens.color.text }}>{t}</div>;
  const body = (t: ReactNode) => <div style={{ fontSize: 13, color: tokens.color.muted, lineHeight: 1.55 }}>{t}</div>;

  // Static export — no MCP backend; nothing to author here.
  if (!mcp) return wrap(<>{title("No documents yet")}{body(`This is a static export — open the project with ${BRAND.cli} serve to author documents.`)}</>);

  const agents = mcp.agents ?? [];
  const desktop = agents.find((a) => a.id === "claude-desktop");
  const projectConfigured = mcp.configured;
  const anyConfigured = projectConfigured || agents.some((a) => a.configured);

  // State A — no usable flow-trace MCP yet.
  if (!anyConfigured) {
    return desktop?.present
      ? wrap(<>{title("Claude Desktop detected — connect it to start")}{body(<>It's installed but not wired to this project yet. Open <b>Connect agent (MCP)</b> in the sidebar to add it (or another agent). {BRAND.display} documents are authored by your AI agent.</>)}</>)
      : wrap(<>{title("Connect an agent to start")}{body(<>{BRAND.display} documents are authored by an AI agent over MCP. Open <b>Connect agent (MCP)</b> in the sidebar to wire one up.</>)}</>);
  }

  // State B/C — an agent can author here. Coach the ask, with a copyable prompt.
  const desktopOnly = !projectConfigured && !!desktop?.configured;
  const prompt = `Use ${BRAND.display} to draw a Flow (and a Sequence where the exact calls matter) of how [the part you want to understand] works, and save it in ${projectRoot ? `this project (${projectRoot})` : "this project"}.`;
  return wrap(
    <>
      {desktopOnly ? body(<><span style={{ color: "#3d7c52" }}>✓ Connected via Claude Desktop.</span> Need another agent? Use <b>Connect agent (MCP)</b>.</>) : null}
      {title("No documents yet")}
      {body("Ask your agent to author one — for example:")}
      <pre style={{ textAlign: "left", background: tokens.color.field, border: `1px solid ${tokens.color.border}`, borderRadius: 8, padding: "10px 12px", fontSize: 12, fontFamily: tokens.font.mono, whiteSpace: "pre-wrap", margin: 0, color: tokens.color.text, userSelect: "text", cursor: "text" }}>{prompt}</pre>
      <button
        className="ft-recent"
        style={{ justifyContent: "center" }}
        onClick={async () => {
          const ok = await copyText(prompt);
          if (ok) {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }
        }}
      >
        {copied ? "Copied ✓" : "Copy prompt"}
      </button>
      {body(<>Tip: ask for a <b>Flow</b> (high-level map) or a <b>Sequence</b> (exact call-by-call trace). The agent saves it under <code>{BRAND.storeDir}/</code> and it appears here automatically.</>)}
    </>,
  );
}

// Drill zoom: ~215ms (was 430 → 100% faster), eased. Dive zooms IN toward the
// drilled object's center (tween-in/accelerate); surface zooms OUT toward the
// scene center (tween-out/decelerate).
const ZOOM_MS = 215;
const easeIn = (t: number) => t * t * t; // accelerate — "diving in"
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3); // decelerate — "surfacing"

type Pt = { x: number; y: number };

/** Manually animate the viewport so we control easing + target point precisely.
 *  Centers flow-point (cx,cy) on screen at targetZoom, then calls onDone. */
function tweenViewport(
  inst: ReactFlowInstance,
  rect: DOMRect,
  cx: number,
  cy: number,
  targetZoom: number,
  ease: (t: number) => number,
  onDone: () => void,
) {
  const v0 = inst.getViewport();
  const tx = rect.width / 2 - cx * targetZoom;
  const ty = rect.height / 2 - cy * targetZoom;
  const t0 = performance.now();
  const step = (now: number) => {
    const p = Math.min(1, (now - t0) / ZOOM_MS);
    const e = ease(p);
    inst.setViewport({
      x: v0.x + (tx - v0.x) * e,
      y: v0.y + (ty - v0.y) * e,
      zoom: v0.zoom + (targetZoom - v0.zoom) * e,
    });
    if (p < 1) requestAnimationFrame(step);
    else onDone();
  };
  requestAnimationFrame(step);
}

export default function App() {
  const { flows, projectName, projectRoot, canWrite, recents, trail, activeId, navigate, drillTo, goToDepth, rename, setCategory, renameCategory, remove, openProject, pickFolder, listDir, parents, mcp, setupMcp, doc, error } =
    useFlowData();
  const [selection, setSelection] = useState<Selection>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [panelOpen, setPanelOpen] = useState(true);
  const [panelWidth, setPanelWidth] = useState<number>(tokens.size.panel);
  const [sidebarWidth, setSidebarWidth] = useState<number>(tokens.size.sidebar);
  const [overviewOpen, setOverviewOpen] = useState(false);
  const [overviewHeight, setOverviewHeight] = useState<number>(132);
  // Sequence diagram sizing (resizable via the top-bar sliders).
  const [seqLaneGap, setSeqLaneGap] = useState<number>(SEQ.laneGap);
  const [seqRowH, setSeqRowH] = useState<number>(SEQ.rowH);
  // The canvas area, measured to auto-fit the sequence width on load.
  const seqAreaRef = useRef<HTMLElement>(null);

  // The active document is a Flow or a Sequence; the view + flow-only logic branch on it.
  const kind = doc ? docKind(doc) : null;
  const flowDoc = kind === "flow" ? (doc as FlowDocument) : null;
  const seqDoc = kind === "sequence" ? (doc as SequenceDocument) : null;

  // Auto-fit the sequence's actor spacing to the canvas width so the scene
  // spreads across the available space instead of crowding the left edge.
  const autoFitLane = useCallback((): number => {
    const n = seqDoc?.actors.length ?? 0;
    const w = (seqAreaRef.current?.clientWidth ?? 0) - SEQ.railW;
    if (n < 2 || w <= 0) return SEQ.laneGap;
    const fit = (w - SEQ.left * 2) / (n - 1);
    return Math.min(SEQ.maxLaneGap, Math.max(SEQ.minLaneGap, fit));
  }, [seqDoc]);
  // Auto-fit width on doc switch + whenever the canvas resizes — unless the user
  // has taken over with the width slider for this document. A ResizeObserver makes
  // "fit on load" reliable regardless of mount/measure timing.
  const userSizedRef = useRef(false);
  useEffect(() => {
    userSizedRef.current = false; // a new document → auto-fit again
  }, [activeId]);
  useEffect(() => {
    const el = seqAreaRef.current;
    if (!el || !seqDoc) return;
    const fit = () => {
      if (!userSizedRef.current) setSeqLaneGap(autoFitLane());
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [seqDoc, autoFitLane]);
  const resetSeqSize = useCallback(() => {
    userSizedRef.current = false;
    setSeqLaneGap(autoFitLane());
    setSeqRowH(SEQ.rowH);
  }, [autoFitLane]);
  const seqControls = seqDoc
    ? {
        laneGap: seqLaneGap,
        rowH: seqRowH,
        width: seqWidth(seqDoc.actors.length, seqLaneGap),
        bounds: { lane: [SEQ.minLaneGap, SEQ.maxLaneGap] as [number, number], row: [SEQ.minRowH, SEQ.maxRowH] as [number, number] },
        onLaneGap: (v: number) => {
          userSizedRef.current = true;
          setSeqLaneGap(v);
        },
        onRowH: setSeqRowH,
        onReset: resetSeqSize,
      }
    : undefined;

  // React Flow instance, captured on init so the double-click handler (which
  // lives on the <ReactFlow> props, outside the provider's hook scope) can pan/zoom.
  const rf = useRef<ReactFlowInstance | null>(null);
  // The canvas wrapper, for pane dimensions during manual viewport tweens.
  const canvasRef = useRef<HTMLDivElement>(null);
  // Manual double-tap detection on single clicks — React Flow's onEdgeDoubleClick
  // is unreliable for custom edges, but onNodeClick/onEdgeClick always fire.
  const lastTap = useRef<{ key: string; t: number }>({ key: "", t: 0 });
  // Navigation direction → drives the canvas reveal (dive-in vs surface-out),
  // which also covers Sequence view where there is no React Flow viewport to tween.
  const navDir = useRef<"down" | "up" | "jump">("jump");

  // Drag the panel's left edge to resize (clamped). Listeners on window so the
  // drag keeps tracking outside the handle.
  const startResize = useCallback(
    (e: ReactPointerEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = panelWidth;
      const onMove = (ev: PointerEvent) => {
        setPanelWidth(Math.min(640, Math.max(280, startW + (startX - ev.clientX))));
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [panelWidth],
  );
  // Sidebar resize — drag its RIGHT edge (grows with the cursor).
  const startSidebarResize = useCallback(
    (e: ReactPointerEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = sidebarWidth;
      const onMove = (ev: PointerEvent) => {
        setSidebarWidth(Math.min(480, Math.max(200, startW + (ev.clientX - startX))));
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [sidebarWidth],
  );

  const overview = doc?.overview;

  // Clear selection when switching documents.
  useEffect(() => setSelection(null), [activeId]);
  // The React Flow instance only exists in Flow view — drop the stale ref in Sequence.
  useEffect(() => {
    if (kind !== "flow") rf.current = null;
  }, [kind, activeId]);
  // Per-document default: open the Overview bar iff this doc has an overview.
  // Only resets on actual document change (not on live re-render of the same doc).
  const ovDocRef = useRef<string | null>(null);
  useEffect(() => {
    if (doc && activeId !== ovDocRef.current) {
      ovDocRef.current = activeId;
      setOverviewOpen(!!doc.overview);
    }
  }, [doc, activeId]);
  // Drag the Overview bar's top edge to resize its height (dragging up = taller).
  const startOverviewResize = useCallback(
    (e: ReactPointerEvent) => {
      e.preventDefault();
      const startY = e.clientY;
      const startH = overviewHeight;
      const onMove = (ev: PointerEvent) => setOverviewHeight(Math.min(420, Math.max(64, startH + (startY - ev.clientY))));
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [overviewHeight],
  );

  // Center (flow coords) of a node/edge, used as the dive-in focal point.
  const objectCenter = useCallback(
    (origin: DrillOrigin): Pt | null => {
      const inst = rf.current;
      if (!inst || !flowDoc) return null;
      const nodeCenter = (id: string): Pt | null => {
        const n = inst.getNode(id);
        if (!n) return null;
        // Use the fixed per-type dims (deterministic) — measured can be 0/undefined.
        const dim = DIMS[(n.type as NodeType) ?? "step"] ?? { w: 0, h: 0 };
        return { x: n.position.x + dim.w / 2, y: n.position.y + dim.h / 2 };
      };
      if (origin.kind === "node") return nodeCenter(origin.id);
      const fe = flowDoc.edges.find((e, i) => edgeKey(e, i) === origin.id);
      if (!fe) return null;
      const a = nodeCenter(fe.from);
      const b = nodeCenter(fe.to);
      if (!a || !b) return null;
      return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    },
    [flowDoc],
  );

  // Geometric center of the whole flow (for the surface/zoom-out focal point).
  const sceneCenter = useCallback((): Pt | null => {
    const inst = rf.current;
    if (!inst) return null;
    const ns = inst.getNodes();
    if (!ns.length) return null;
    const b = getNodesBounds(ns);
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  }, []);

  // Deeper + faster than before: dive zooms IN ~3.3× (tween-in) toward the
  // object; surface zooms OUT ~0.27× (tween-out) toward the scene center.
  const dive = useCallback(
    (center: Pt | null, fn: () => void) => {
      const inst = rf.current;
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!inst || !rect || !center) return fn();
      tweenViewport(inst, rect, center.x, center.y, Math.min(4, inst.getZoom() * 3.3), easeIn, fn);
    },
    [],
  );
  const surface = useCallback(
    (fn: () => void) => {
      const inst = rf.current;
      const rect = canvasRef.current?.getBoundingClientRect();
      const c = sceneCenter();
      if (!inst || !rect || !c) return fn();
      tweenViewport(inst, rect, c.x, c.y, Math.max(0.08, inst.getZoom() * 0.27), easeOut, fn);
    },
    [sceneCenter],
  );

  // Set of flow ids that exist → gates drill-down (dangling subflow = disabled).
  const flowsSet = useMemo(() => new Set(flows.map((f) => f.id)), [flows]);
  const onDrill = useCallback(
    (target: string, origin?: DrillOrigin) => {
      if (!flowsSet.has(target)) return;
      navDir.current = "down";
      dive(origin ? objectCenter(origin) : null, () => drillTo(target));
    },
    [flowsSet, drillTo, dive, objectCenter],
  );
  // Breadcrumb = drill-up: surface (zoom out to scene center), then go to that level.
  const onCrumb = useCallback(
    (i: number) => {
      navDir.current = "up";
      surface(() => goToDepth(i));
    },
    [goToDepth, surface],
  );
  // Sidebar jump (resets the trail) — neutral reveal.
  const onSidebarSelect = useCallback(
    (id: string) => {
      navDir.current = "jump";
      navigate(id);
    },
    [navigate],
  );

  // Breadcrumb segments: resolve titles from the workspace list; the active
  // (tail) flow prefers the loaded doc's title.
  const trailMeta: Crumb[] = useMemo(() => {
    const titleOf = (id: string) => flows.find((f) => f.id === id)?.title ?? id;
    return trail.map((id, i) => ({
      id,
      title: i === trail.length - 1 && doc ? doc.title : titleOf(id),
    }));
  }, [trail, flows, doc]);

  // Actors exist on both Flow and Trace documents (lifeline colors reuse the same).
  const colors = useMemo(() => (doc ? buildActorColors(doc.actors) : {}), [doc]);
  const actorsById = useMemo(
    () => (doc ? (Object.fromEntries(doc.actors.map((a) => [a.id, a])) as Record<string, Actor>) : {}),
    [doc],
  );
  const base = useMemo(
    () => (flowDoc ? buildGraph(flowDoc, colors, { onDrill, flowsSet }) : { nodes: [], edges: [] }),
    [flowDoc, colors, onDrill, flowsSet],
  );

  // Which node ids are highlighted: one node, or every node of the selected actor.
  const selectedIds = useMemo(() => {
    if (!selection || !flowDoc) return new Set<string>();
    if (selection.kind === "node") return new Set([selection.id]);
    if (selection.kind === "actor") return new Set(flowDoc.nodes.filter((n) => n.owner === selection.id).map((n) => n.id));
    return new Set<string>();
  }, [selection, flowDoc]);

  const nodes: Node[] = useMemo(
    () => base.nodes.map((n) => ({ ...n, selected: selectedIds.has(n.id) })),
    [base.nodes, selectedIds],
  );

  // Mark the selected edge so the custom edge highlights + animates. Inject an
  // onSelect so clicking the edge's LABEL selects it via the same App-state path
  // as clicking the line (React Flow's internal `selected` is not our source of truth).
  const edges: Edge[] = useMemo(
    () =>
      base.edges.map((e) => ({
        ...e,
        selected: selection?.kind === "edge" && selection.id === e.id,
        data: { ...e.data, onSelect: () => setSelection({ kind: "edge", id: e.id }) },
      })),
    [base.edges, selection],
  );

  // Map renderer edge-id → source FlowEdge (same id scheme as buildGraph).
  const edgesById = useMemo(() => {
    const m = new Map<string, FlowEdge>();
    flowDoc?.edges.forEach((e, i) => m.set(edgeKey(e, i), e));
    return m;
  }, [flowDoc]);

  const selectedNode: FlowNode | null =
    selection?.kind === "node" ? (flowDoc?.nodes.find((n) => n.id === selection.id) ?? null) : null;
  const selectedEdge: FlowEdge | null =
    selection?.kind === "edge" ? (edgesById.get(selection.id) ?? null) : null;
  // --- sequence-derived relationships (caller/callee) + reuse detection (×N) ---
  const flatCalls = useMemo(() => (seqDoc ? flattenCalls(seqDoc.calls) : []), [seqDoc]);
  const callById = useMemo(() => new Map(flatCalls.map((c) => [c.id, c])), [flatCalls]);
  const parentById = useMemo(() => {
    const m = new Map<string, string>();
    const walk = (cs: SequenceCall[], parent: string | null) =>
      cs.forEach((c) => {
        if (parent) m.set(c.id, parent);
        if (c.children?.length) walk(c.children, c.id);
      });
    if (seqDoc) walk(seqDoc.calls, null);
    return m;
  }, [seqDoc]);
  // Identity for reuse: a source ref (file:symbol:line) if present — strongest —
  // else the (callee, method) pair. Same key at 2+ call-sites ⇒ a reused method.
  const reuseKey = (c: SequenceCall): string =>
    c.source ? `s|${c.source.file ?? ""}|${c.source.symbol ?? ""}|${c.source.line ?? ""}` : `m|${c.to}|${c.method}`;
  const reuseGroups = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const c of flatCalls) {
      const k = reuseKey(c);
      const arr = m.get(k);
      if (arr) arr.push(c.id);
      else m.set(k, [c.id]);
    }
    return m;
  }, [flatCalls]);
  const reuseCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const ids of reuseGroups.values()) if (ids.length > 1) ids.forEach((id) => m.set(id, ids.length));
    return m;
  }, [reuseGroups]);

  const selectedCall: SequenceCall | null = useMemo(
    () => (selection?.kind === "call" ? (callById.get(selection.id) ?? null) : null),
    [selection, callById],
  );
  // Caller (tree parent) + callees (children) of the selected call.
  const callerId = selectedCall ? (parentById.get(selectedCall.id) ?? null) : null;
  const calleeIds = useMemo(
    () => new Set((selectedCall?.children ?? []).map((c) => c.id)),
    [selectedCall],
  );
  // Occurrences of the selected reused method (flow order), for ×N navigation.
  const occIndex = useMemo(() => {
    const m = new Map<string, number>();
    if (selectedCall) {
      const ids = reuseGroups.get(reuseKey(selectedCall)) ?? [];
      if (ids.length > 1) ids.forEach((id, i) => m.set(id, i + 1));
    }
    return m;
  }, [selectedCall, reuseGroups]);

  // Navigate (pill / occurrence / minimap) → select + scroll the row into view.
  const [scrollNonce, setScrollNonce] = useState(0);
  const navTargetRef = useRef<string | null>(null);
  const navigateCall = useCallback((id: string) => {
    navTargetRef.current = id;
    setScrollNonce((n) => n + 1);
    setSelection({ kind: "call", id });
  }, []);
  const callPeers = useMemo(
    () =>
      selectedCall
        ? {
            caller: callerId ? (callById.get(callerId) ?? null) : null,
            callees: selectedCall.children ?? [],
            occurrences: [...occIndex.entries()]
              .sort((a, b) => a[1] - b[1])
              .map(([id, index]) => ({ id, index, call: callById.get(id) ?? null })),
          }
        : null,
    [selectedCall, callerId, callById, occIndex],
  );

  const owner = selectedNode?.owner ? actorsById[selectedNode.owner] : undefined;

  // Drill is enabled when the selected node/edge has a subflow/sequence target that exists.
  const drillTarget =
    (selectedNode?.type === "subflow" ? selectedNode.subflow : undefined) ??
    selectedNode?.sequence ??
    selectedEdge?.subflow ??
    selectedEdge?.sequence;
  const canDrill = !!drillTarget && flowsSet.has(drillTarget);

  const selectedActor: ActorView | null = useMemo(() => {
    if (selection?.kind !== "actor" || !flowDoc) return null;
    const a = actorsById[selection.id];
    if (!a) return null;
    return {
      id: a.id,
      label: a.label,
      kind: a.kind,
      color: colors[a.id],
      count: flowDoc.nodes.filter((n) => n.owner === a.id).length,
      total: flowDoc.nodes.length,
    };
  }, [selection, flowDoc, actorsById, colors]);

  const toggleActor = (id: string) =>
    setSelection((cur) => (cur?.kind === "actor" && cur.id === id ? null : { kind: "actor", id }));

  // Double-tap: if the object drills down (subflow or trace) → drill directly;
  // otherwise center+zoom.
  const fitToNodes = (ids: string[]) =>
    rf.current?.fitView({ nodes: ids.map((id) => ({ id })), duration: 400, maxZoom: 1.9, padding: 0.6 });
  const onNodeDouble = (id: string) => {
    const fn = flowDoc?.nodes.find((n) => n.id === id);
    const target = (fn?.type === "subflow" ? fn.subflow : undefined) ?? fn?.sequence;
    if (target && flowsSet.has(target)) onDrill(target, { kind: "node", id });
    else fitToNodes([id]);
  };
  const onEdgeDouble = (rendererId: string, source: string, target: string) => {
    const fe = flowDoc?.edges.find((e, i) => edgeKey(e, i) === rendererId);
    const t = fe?.subflow ?? fe?.sequence;
    if (t && flowsSet.has(t)) onDrill(t, { kind: "edge", id: rendererId });
    else fitToNodes([source, target]);
  };
  // Single click selects; a second click on the same target within the window
  // is treated as a double-tap (center / drill).
  const DOUBLE_MS = 350;
  const isDoubleTap = (key: string): boolean => {
    const now = performance.now();
    if (lastTap.current.key === key && now - lastTap.current.t < DOUBLE_MS) {
      lastTap.current = { key: "", t: 0 };
      return true;
    }
    lastTap.current = { key, t: now };
    return false;
  };
  const tapNode = (id: string) => {
    if (isDoubleTap("node:" + id)) onNodeDouble(id);
    else setSelection({ kind: "node", id });
  };
  const tapEdge = (id: string, source: string, target: string) => {
    if (isDoubleTap("edge:" + id)) onEdgeDouble(id, source, target);
    else setSelection({ kind: "edge", id });
  };
  const tapCall = (id: string) => setSelection({ kind: "call", id });

  return (
    <ReactFlowProvider>
      <div style={{ width: "100vw", height: "100vh", display: "flex", flexDirection: "column", background: tokens.color.canvas, overflow: "hidden" }}>
        <TopBar trail={trailMeta} onCrumb={onCrumb} tab={kind === "sequence" ? "sequence" : "flow"} seq={seqControls} />

        <div style={{ flex: "1 1 auto", display: "flex", minHeight: 0 }}>
          <Sidebar
            flows={flows}
            activeFlow={activeId ?? ""}
            projectName={projectName}
            canWrite={canWrite}
            recents={recents}
            open={sidebarOpen}
            onToggle={() => setSidebarOpen((v) => !v)}
            onSelectFlow={onSidebarSelect}
            onRename={rename}
            onSetCategory={setCategory}
            onRenameCategory={renameCategory}
            onDelete={remove}
            onOpenProject={openProject}
            onPickFolder={pickFolder}
            onListDir={listDir}
            parents={parents}
            mcp={mcp}
            onSetupMcp={setupMcp}
            width={sidebarWidth}
            onResizeStart={startSidebarResize}
          />

          <main ref={seqAreaRef} style={{ flex: "1 1 auto", minWidth: 0, display: "flex", flexDirection: "column" }}>
            <div style={{ flex: "1 1 auto", position: "relative", minHeight: 0 }}>
              {error ? <Banner text={error} /> : null}
              {!error && !activeId ? (
                flows.length ? <Placeholder text="Select a document from the sidebar." /> : <EmptyState mcp={mcp} projectRoot={projectRoot} />
              ) : null}
              {!error && activeId && !doc ? <Placeholder text="Loading…" /> : null}
              {/* Keyed wrapper → remounts + soft reveal on flow change; live updates
                  (same activeId) don't remount, preserving viewport/selection.
                  Mounted only when a document is shown — otherwise this absolute
                  overlay would sit over (and swallow clicks on) the empty state. */}
              {doc ? (
              <div ref={canvasRef} key={activeId ?? "none"} className={navDir.current === "up" ? "ft-canvas-out" : "ft-canvas-in"} style={{ position: "absolute", inset: 0 }}>
              <ErrorBoundary>
              {seqDoc ? (
                <SequenceCanvas
                  doc={seqDoc}
                  laneGap={seqLaneGap}
                  rowH={seqRowH}
                  selectedId={selection?.kind === "call" ? selection.id : null}
                  reuseCount={reuseCount}
                  occIndex={occIndex}
                  callerId={callerId}
                  calleeIds={calleeIds}
                  scrollToId={navTargetRef.current}
                  scrollNonce={scrollNonce}
                  onSelectCall={tapCall}
                  onNavigate={navigateCall}
                  onPaneClick={() => setSelection(null)}
                />
              ) : (
                <ReactFlow
                  nodes={nodes}
                  edges={edges}
                  nodeTypes={nodeTypes}
                  edgeTypes={edgeTypes}
                  fitView
                  minZoom={0.2}
                  maxZoom={4}
                  zoomOnScroll
                  zoomOnDoubleClick={false}
                  nodesDraggable={false}
                  nodesConnectable={false}
                  proOptions={{ hideAttribution: true }}
                  onInit={(inst) => (rf.current = inst)}
                  onNodeClick={(_, node) => tapNode(node.id)}
                  onEdgeClick={(_, edge) => tapEdge(edge.id, edge.source, edge.target)}
                  onPaneClick={() => setSelection(null)}
                >
                  <Background variant={BackgroundVariant.Lines} gap={tokens.grid} size={1} color={tokens.color.gridLine} />
                  <MiniMap
                    pannable
                    zoomable
                    nodeColor={(n) => (n.data as NodeData)?.color ?? NEUTRAL}
                    nodeStrokeColor={(n) => (n.data as NodeData)?.color ?? NEUTRAL}
                    nodeStrokeWidth={3}
                    nodeBorderRadius={3}
                    maskColor="rgba(74,66,48,0.12)"
                    maskStrokeColor="rgba(94,84,168,0.5)"
                    maskStrokeWidth={2}
                    style={{ width: 96, height: 72, background: "#FCFAF4" }}
                  />
                  <Panel position="bottom-left">
                    <ZoomControls />
                  </Panel>
                  <Panel position="top-left">
                    <Legend
                      actors={flowDoc?.actors ?? []}
                      colors={colors}
                      activeId={selection?.kind === "actor" ? selection.id : null}
                      onSelect={toggleActor}
                    />
                  </Panel>
                </ReactFlow>
              )}
              </ErrorBoundary>
              </div>
              ) : null}
            </div>
            <OverviewBar
              overview={overview}
              open={overviewOpen}
              height={overviewHeight}
              onToggle={() => setOverviewOpen((v) => !v)}
              onResizeStart={startOverviewResize}
            />
          </main>

          <DetailPanel
            node={selectedNode}
            edge={selectedEdge}
            call={selectedCall}
            callActors={seqDoc ? actorsById : undefined}
            callPeers={callPeers}
            onNavigateCall={navigateCall}
            ownerLabel={owner?.label}
            ownerColor={selectedNode?.owner ? colors[selectedNode.owner] : undefined}
            actor={selectedActor}
            open={panelOpen}
            onToggle={() => setPanelOpen((v) => !v)}
            onDeselect={() => setSelection(null)}
            canDrill={canDrill}
            onDrill={(t) =>
              onDrill(
                t,
                selection?.kind === "node" || selection?.kind === "edge"
                  ? { kind: selection.kind, id: selection.id }
                  : undefined,
              )
            }
            width={panelWidth}
            onResizeStart={startResize}
          />
        </div>
      </div>
    </ReactFlowProvider>
  );
}
