import dagre from "dagre";
import { MarkerType, type Edge, type Node } from "@xyflow/react";
import type { ActorColors } from "./theme";
import { NEUTRAL } from "./theme";
import type { DrillHandler, FlowDocument, FlowEdge, NodeData, NodeType } from "./model";

/** Stable id for an edge: explicit `id` if authored, else positional fallback.
 *  Shared by the renderer (selection) and App (selection → FlowEdge lookup). */
export function edgeKey(e: FlowEdge, i: number): string {
  return e.id ?? `e${i}`;
}

// Fixed node dimensions per type — shared by the custom node components and by
// dagre (so the auto-layout matches what is rendered).
export const DIMS: Record<NodeType, { w: number; h: number }> = {
  terminal: { w: 130, h: 44 },
  step: { w: 200, h: 58 },
  decision: { w: 130, h: 130 },
  subflow: { w: 210, h: 66 },
  io: { w: 200, h: 58 },
};

// ── Decision diamond auto-size ────────────────────────────────────────────
// A label lives in the diamond's INSCRIBED square (side = S/2 for a bbox of S).
// The default 130 box gives only a ~65px inscribed square, so a long label still
// overflows even at the FitLabel min font. So: grow the diamond just enough that
// the label fits its inscribed square at the min font. Deterministic (length-
// based, no DOM) so dagre — which needs sizes up front — and the node component
// agree. Short labels keep the default 130; only long ones grow ("слегка").
const DECISION_MIN_FONT = 8; // must match FitLabel min in src/nodes (decision)
const DECISION_CHAR_W = 0.62; // px per char per font-px (semibold, conservative)
const DECISION_LINE_H = 1.25;

/** Bounding size (px) for a decision node whose label is `label`. */
export function decisionSize(label: string): number {
  const f = DECISION_MIN_FONT;
  const longest = label.trim().split(/\s+/).reduce((m, w) => Math.max(m, w.length), 0);
  // Inscribed square must hold the longest word on one line AND the wrapped block.
  const byWord = longest * f * DECISION_CHAR_W;
  const byArea = Math.sqrt(label.length * (f * DECISION_CHAR_W) * (f * DECISION_LINE_H) * 1.4);
  const inscribed = Math.max(byWord, byArea);
  const s = Math.ceil(inscribed * 2); // S = 2 × inscribed-square side
  return Math.max(DIMS.decision.w, Math.min(240, s));
}

/** Rendered bounding box of a node — decision grows with its label; others fixed. */
function nodeDims(n: Node): { w: number; h: number } {
  if (n.type === "decision") {
    const s = (n.data as NodeData).decisionSize ?? DIMS.decision.w;
    return { w: s, h: s };
  }
  return DIMS[n.type as NodeType];
}

const EDGE_COLOR = "#9a9384";

// ── Edge-label box metrics ────────────────────────────────────────────────
// One source of truth for the label's rendered size, shared by the renderer
// (it caps + wraps the label to this box) and by dagre (it reserves this box so
// the layout spreads nodes/edges enough that labels don't land on top of each
// other or on a node). Keeping them in sync is the whole fix: previously dagre
// reserved ~190px while the DOM label rendered at full natural width and bled
// over its siblings. Estimates are deliberately conservative (round up lines).
export const LABEL_MAX_W = 200; // px — hard visual cap; longer text wraps
const LABEL_CHAR_W = 6.2; // approx px per char at 11px / 600 weight
const LABEL_LINE_H = 15; // px per wrapped line
const LABEL_PAD_X = 12; // 6px left + 6px right
const LABEL_PAD_Y = 4; // 2px top + 2px bottom

/** Rendered size of an edge label once capped + wrapped to LABEL_MAX_W. */
export function labelBox(label: string): { width: number; height: number } {
  const textW = label.length * LABEL_CHAR_W;
  const innerW = LABEL_MAX_W - LABEL_PAD_X;
  const lines = Math.max(1, Math.ceil(textW / innerW));
  return {
    width: Math.min(LABEL_MAX_W, Math.ceil(textW) + LABEL_PAD_X),
    height: lines * LABEL_LINE_H + LABEL_PAD_Y,
  };
}

/** Drill-down wiring passed through to subflow nodes (docs/concepts.md §7.3). */
export interface DrillOptions {
  /** Set of flow ids that exist in the workspace (to gate dangling subflows). */
  flowsSet?: Set<string>;
  /** Invoked by a subflow node's / edge's "Open" control. */
  onDrill?: DrillHandler;
}

// Flow layout compactness (the single Flow spacing slider). `gap` drives dagre's
// rank separation; node separation tracks it proportionally. Lower = tighter.
export const FLOW_SPACING = { default: 50, min: 40, max: 130 } as const;

/** Build positioned React Flow nodes + styled edges from a Flow document. */
export function buildGraph(
  doc: FlowDocument,
  colors: ActorColors,
  drill?: DrillOptions,
  gap: number = FLOW_SPACING.default,
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = doc.nodes.map((n) => {
    const data: NodeData = {
      label: n.label,
      color: n.owner ? (colors[n.owner] ?? NEUTRAL) : NEUTRAL,
      summary: n.description?.[0],
      owner: n.owner,
      shared: n.shared,
    };
    if (n.type === "decision") data.decisionSize = decisionSize(n.label);
    // Drill target: a sub-flow (type:subflow) or a sequence (any node with `sequence`).
    const subTarget = n.type === "subflow" ? n.subflow : undefined;
    const target = subTarget ?? n.sequence;
    if (target) {
      data.drillTarget = target;
      data.drillKind = subTarget ? "flow" : "sequence";
      data.canDrill = drill?.flowsSet ? drill.flowsSet.has(target) : false;
      data.onDrill = drill?.onDrill;
    }
    return { id: n.id, type: n.type, position: { x: 0, y: 0 }, data };
  });

  const edges: Edge[] = doc.edges.map((e, i) => {
    // An edge drills into a sub-flow (`subflow`) OR a sequence (`sequence`) — same
    // as a node. (Previously only `subflow` was wired, so an edge→sequence drill
    // had no on-canvas control at all.)
    const target = e.subflow ?? e.sequence;
    return {
      id: edgeKey(e, i),
      source: e.from,
      target: e.to,
      type: "ft",
      data: {
        edgeType: e.type,
        label: e.label,
        drillTarget: target,
        drillKind: e.subflow ? ("flow" as const) : e.sequence ? ("sequence" as const) : undefined,
        canDrill: target ? (drill?.flowsSet?.has(target) ?? false) : false,
        onDrill: drill?.onDrill,
      },
      markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: EDGE_COLOR },
    };
  });

  return layout(nodes, edges, doc.layout ?? "TB", gap);
}

function layout(nodes: Node[], edges: Edge[], dir: "TB" | "LR", gap: number): { nodes: Node[]; edges: Edge[] } {
  // multigraph: true → named edges (we name each edge by id to read back its
  // routed waypoints AND to keep parallel edges between the same pair distinct).
  const g = new dagre.graphlib.Graph({ multigraph: true });
  g.setDefaultEdgeLabel(() => ({}));
  // `gap` (the Flow spacing slider) sets rank separation; node separation tracks it.
  g.setGraph({ rankdir: dir, nodesep: Math.round(gap * 0.7), ranksep: gap, marginx: 24, marginy: 24 });

  nodes.forEach((n) => {
    const dim = nodeDims(n);
    g.setNode(n.id, { width: dim.w, height: dim.h });
  });
  // Name each edge (its id) so dagre keeps parallel edges distinct and we can read
  // back its routed waypoints.
  // Give dagre the label's size so it reserves space for it (keeps the label from
  // landing on top of a node).
  edges.forEach((e) => {
    const label = (e.data as { label?: string } | undefined)?.label;
    // Reserve the label's REAL (capped + wrapped) box so dagre spreads the graph
    // accordingly — must match what the edge component renders (see labelBox).
    const lbl = label ? { ...labelBox(label), labelpos: "c" as const } : {};
    g.setEdge(e.source, e.target, lbl, e.id);
  });

  dagre.layout(g);

  const positioned = nodes.map((n) => {
    const dim = nodeDims(n);
    const p = g.node(n.id);
    return { ...n, position: { x: p.x - dim.w / 2, y: p.y - dim.h / 2 } };
  });

  // Which side of a node a routed endpoint sits on — decided by which EDGE of the
  // node's rectangle the point is closest to (dagre clips edges to the box, so the
  // endpoint lies on one of the four sides). We then re-anchor the line to that
  // side's handle. Using the nearest-edge (not a centre-relative dominant axis)
  // matters near a corner: a point at the top-left corner is on the TOP edge, but a
  // dominant-axis test can mis-call it "left" — and then the line, re-anchored to the
  // left handle while its next waypoint heads up, grazes the node and hides the
  // arrowhead. Picking the side dagre actually routed to keeps the arrow visible at
  // any spacing (recomputed on every layout, so it self-corrects when the gap shrinks).
  const sideOf = (p: { x: number; y: number }, n: { x: number; y: number; width: number; height: number }): string => {
    const dl = Math.abs(p.x - (n.x - n.width / 2));
    const dr = Math.abs(p.x - (n.x + n.width / 2));
    const dt = Math.abs(p.y - (n.y - n.height / 2));
    const db = Math.abs(p.y - (n.y + n.height / 2));
    const m = Math.min(dl, dr, dt, db);
    return m === dt ? "top" : m === db ? "bottom" : m === dl ? "left" : "right";
  };

  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  // Hand dagre's routed polyline (avoids the nodes) to the custom edge renderer.
  const routed = edges.map((e) => {
    const ge = g.edge(e.source, e.target, e.id) as { points?: { x: number; y: number }[]; x?: number; y?: number } | undefined;
    const points = ge?.points;
    if (!points || points.length < 2) return e;
    const sc = g.node(e.source) as { x: number; y: number; width: number; height: number };
    const tc = g.node(e.target) as { x: number; y: number; width: number; height: number };
    const sourceHandle = `s-${sideOf(points[0], sc)}`;
    const targetHandle = `t-${sideOf(points[points.length - 1], tc)}`;
    const labelXY = ge && typeof ge.x === "number" ? { x: ge.x, y: ge.y as number } : undefined;
    // Source/target node boxes → the edge renderer clips each END to the node border
    // (+gap) along the route direction, so the line leaves/enters where it actually
    // heads instead of snapping to a side-handle midpoint (which made edges depart
    // from a node's side or graze its corner).
    const tn = nodeById.get(e.target);
    const td = tn ? nodeDims(tn) : undefined;
    const targetBox = td ? { x: tc.x - td.w / 2, y: tc.y - td.h / 2, w: td.w, h: td.h } : undefined;
    const sn = nodeById.get(e.source);
    const sd = sn ? nodeDims(sn) : undefined;
    const sourceBox = sd ? { x: sc.x - sd.w / 2, y: sc.y - sd.h / 2, w: sd.w, h: sd.h } : undefined;
    return { ...e, sourceHandle, targetHandle, data: { ...e.data, points, labelXY, sourceBox, targetBox } };
  });

  return { nodes: positioned, edges: routed };
}
