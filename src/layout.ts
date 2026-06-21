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

const EDGE_COLOR = "#9a9384";

/** Drill-down wiring passed through to subflow nodes (docs/concepts.md §7.3). */
export interface DrillOptions {
  /** Set of flow ids that exist in the workspace (to gate dangling subflows). */
  flowsSet?: Set<string>;
  /** Invoked by a subflow node's / edge's "Open" control. */
  onDrill?: DrillHandler;
}

/** Build positioned React Flow nodes + styled edges from a Flow document. */
export function buildGraph(
  doc: FlowDocument,
  colors: ActorColors,
  drill?: DrillOptions,
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = doc.nodes.map((n) => {
    const data: NodeData = {
      label: n.label,
      color: n.owner ? (colors[n.owner] ?? NEUTRAL) : NEUTRAL,
      summary: n.description?.[0],
      owner: n.owner,
      shared: n.shared,
    };
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

  const edges: Edge[] = doc.edges.map((e, i) => ({
    id: edgeKey(e, i),
    source: e.from,
    target: e.to,
    type: "ft",
    data: {
      edgeType: e.type,
      label: e.label,
      subflow: e.subflow,
      canDrill: e.subflow ? (drill?.flowsSet?.has(e.subflow) ?? false) : false,
      onDrill: drill?.onDrill,
    },
    markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: EDGE_COLOR },
  }));

  return layout(nodes, edges, doc.layout ?? "TB");
}

function layout(nodes: Node[], edges: Edge[], dir: "TB" | "LR"): { nodes: Node[]; edges: Edge[] } {
  // multigraph: true → named edges (we name each edge by id to read back its
  // routed waypoints AND to keep parallel edges between the same pair distinct).
  const g = new dagre.graphlib.Graph({ multigraph: true });
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: dir, nodesep: 64, ranksep: 96, marginx: 24, marginy: 24 });

  nodes.forEach((n) => {
    const dim = DIMS[n.type as NodeType];
    g.setNode(n.id, { width: dim.w, height: dim.h });
  });
  // Name each edge (its id) so dagre keeps parallel edges distinct and we can read
  // back its routed waypoints.
  // Give dagre the label's size so it reserves space for it (keeps the label from
  // landing on top of a node).
  edges.forEach((e) => {
    const label = (e.data as { label?: string } | undefined)?.label;
    const lbl = label ? { width: Math.min(190, label.length * 6.6 + 14), height: 20, labelpos: "c" as const } : {};
    g.setEdge(e.source, e.target, lbl, e.id);
  });

  dagre.layout(g);

  const positioned = nodes.map((n) => {
    const dim = DIMS[n.type as NodeType];
    const p = g.node(n.id);
    return { ...n, position: { x: p.x - dim.w / 2, y: p.y - dim.h / 2 } };
  });

  // Which side of a node a point sits on (relative to the node's centre): the
  // dominant axis decides. Used to pick the handle an edge attaches to so a
  // return/retry edge arriving from below enters the node's bottom/side handle
  // instead of being forced to the top handle (which made it wrap under the node).
  const sideOf = (p: { x: number; y: number }, c: { x: number; y: number }): string =>
    Math.abs(p.x - c.x) > Math.abs(p.y - c.y) ? (p.x > c.x ? "right" : "left") : (p.y > c.y ? "bottom" : "top");

  // Hand dagre's routed polyline (avoids the nodes) to the custom edge renderer.
  const routed = edges.map((e) => {
    const ge = g.edge(e.source, e.target, e.id) as { points?: { x: number; y: number }[]; x?: number; y?: number } | undefined;
    const points = ge?.points;
    if (!points || points.length < 2) return e;
    const sc = g.node(e.source) as { x: number; y: number };
    const tc = g.node(e.target) as { x: number; y: number };
    const sourceHandle = `s-${sideOf(points[0], sc)}`;
    const targetHandle = `t-${sideOf(points[points.length - 1], tc)}`;
    const labelXY = ge && typeof ge.x === "number" ? { x: ge.x, y: ge.y as number } : undefined;
    return { ...e, sourceHandle, targetHandle, data: { ...e.data, points, labelXY } };
  });

  return { nodes: positioned, edges: routed };
}
