import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type EdgeProps } from "@xyflow/react";
import type { MouseEvent } from "react";
import type { DrillHandler, EdgeType } from "../model";
import { IconEnter } from "../shell/icons";

// Custom edge: a first-class, selectable object. On selection it highlights and
// dots travel start → end (a delicate sense of movement, docs/flow-mode.md).

const EDGE_COLOR = "#9a9384";
// RESERVED selection color — deliberately the brand ink, OUTSIDE the actor
// palette (src/theme.ts), so a selected edge never reads as belonging to an
// actor whose hue happens to be similar.
const SELECT = "#2D2A24";
const DOT = "#FCFAF4"; // light pulses, visible travelling along the dark line
const DUR = 4.2; // seconds — slowed a further 40% (3s → 4.2s)

export interface FtEdgeData {
  edgeType: EdgeType;
  label?: string;
  subflow?: string;
  canDrill?: boolean;
  onDrill?: DrillHandler;
  /** dagre-routed waypoints (avoid the nodes); set by layout(). */
  points?: { x: number; y: number }[];
  /** dagre-computed label center (reserved space, clear of nodes). */
  labelXY?: { x: number; y: number };
  /** Select this edge (App-state selection) — called when its label is clicked. */
  onSelect?: () => void;
  [key: string]: unknown;
}

/** A polyline through `pts` with rounded corners — used to draw dagre's routed path. */
function roundedPath(pts: { x: number; y: number }[], r = 9): string {
  if (pts.length < 2) return "";
  if (pts.length === 2) return `M ${pts[0].x},${pts[0].y} L ${pts[1].x},${pts[1].y}`;
  let d = `M ${pts[0].x},${pts[0].y}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const p0 = pts[i - 1];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const l1 = Math.hypot(p1.x - p0.x, p1.y - p0.y) || 1;
    const l2 = Math.hypot(p2.x - p1.x, p2.y - p1.y) || 1;
    const rr = Math.min(r, l1 / 2, l2 / 2);
    const a = { x: p1.x - ((p1.x - p0.x) / l1) * rr, y: p1.y - ((p1.y - p0.y) / l1) * rr };
    const b = { x: p1.x + ((p2.x - p1.x) / l2) * rr, y: p1.y + ((p2.y - p1.y) / l2) * rr };
    d += ` L ${a.x},${a.y} Q ${p1.x},${p1.y} ${b.x},${b.y}`;
  }
  const last = pts[pts.length - 1];
  d += ` L ${last.x},${last.y}`;
  return d;
}

export function FtEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  selected,
  data,
}: EdgeProps) {
  const d = (data ?? {}) as FtEdgeData;
  const isReturn = d.edgeType === "return";
  let path: string;
  let labelX: number;
  let labelY: number;
  if (d.points && d.points.length >= 2) {
    // Use dagre's routed waypoints — they go AROUND the nodes (no crossings/overlap)
    // and attach at the side dagre chose (so a return reads as a clear detour, not a
    // line through the nodes it spans). Recomputed on every layout change.
    // Leave an equal GAP at BOTH ends so the line never jams into a node and reads
    // symmetric (same breathing room where it leaves the source as where it meets
    // the target). Anchor the endpoints to the REAL handle coordinates React Flow
    // gives us (sourceX/Y, targetX/Y) rather than dagre's slightly-off first/last
    // points, so the line sits dead-centre on the handles instead of drifting.
    const pts = d.points.map((p) => ({ x: p.x, y: p.y }));
    pts[0] = { x: sourceX, y: sourceY };
    pts[pts.length - 1] = { x: targetX, y: targetY };
    const GAP = 2; // small, equal breathing room at both ends
    // Pull the END back along its last segment.
    const last = pts[pts.length - 1];
    const prev = pts[pts.length - 2];
    const dx = last.x - prev.x;
    const dy = last.y - prev.y;
    const len = Math.hypot(dx, dy) || 1;
    if (len > GAP) pts[pts.length - 1] = { x: last.x - (dx / len) * GAP, y: last.y - (dy / len) * GAP };
    // Pull the START forward along its first segment (mirror of the end gap).
    const first = pts[0];
    const next = pts[1];
    const sdx = next.x - first.x;
    const sdy = next.y - first.y;
    const slen = Math.hypot(sdx, sdy) || 1;
    if (slen > GAP) pts[0] = { x: first.x + (sdx / slen) * GAP, y: first.y + (sdy / slen) * GAP };
    path = roundedPath(pts, 9);
    const m = d.labelXY ?? pts[Math.floor(pts.length / 2)];
    labelX = m.x;
    labelY = m.y;
  } else if (isReturn) {
    const bow = Math.max(70, Math.abs(sourceY - targetY) * 0.35);
    const cx = Math.max(sourceX, targetX) + bow;
    path = `M ${sourceX},${sourceY} C ${cx},${sourceY} ${cx},${targetY} ${targetX},${targetY}`;
    labelX = cx - 6;
    labelY = (sourceY + targetY) / 2;
  } else {
    [path, labelX, labelY] = getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, borderRadius: 10 });
  }
  const stroke = selected ? SELECT : EDGE_COLOR;

  // 2–5 travelling dots, scaled to the edge's (approx) length.
  const dist = Math.abs(targetX - sourceX) + Math.abs(targetY - sourceY);
  const dotCount = Math.max(2, Math.min(5, Math.round(dist / 130)));

  const openSubflow = (e: MouseEvent) => {
    e.stopPropagation();
    if (d.canDrill && d.subflow) d.onDrill?.(d.subflow, { kind: "edge", id });
  };

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        interactionWidth={36}
        style={{
          stroke,
          strokeWidth: selected ? 2.6 : 1.5,
          strokeDasharray: isReturn ? "6 4" : undefined,
          transition: "stroke .12s ease, stroke-width .12s ease",
        }}
      />
      {selected
        ? Array.from({ length: dotCount }).map((_, i) => (
            <circle key={i} r={3.4} fill={DOT} stroke={SELECT} strokeWidth={0.75}>
              <animateMotion
                dur={`${DUR}s`}
                repeatCount="indefinite"
                path={path}
                rotate="auto"
                begin={`${-(DUR / dotCount) * i}s`}
              />
            </circle>
          ))
        : null}

      {/* On-canvas "Open" control above a selected edge that drills down. */}
      {selected && d.subflow ? (
        <EdgeLabelRenderer>
          <button
            className="nodrag nopan"
            onClick={openSubflow}
            disabled={!d.canDrill}
            title={d.canDrill ? `Open sub-flow: ${d.subflow}` : `Sub-flow '${d.subflow}' not found in workspace`}
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY - 26}px)`,
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              padding: "3px 9px 3px 7px",
              border: `1px solid ${SELECT}`,
              borderRadius: 7,
              background: d.canDrill ? SELECT : "#f4f1ea",
              color: d.canDrill ? "#fff" : "#b8b1a2",
              fontSize: 11,
              fontWeight: 600,
              fontFamily: "inherit",
              cursor: d.canDrill ? "pointer" : "not-allowed",
              lineHeight: 1,
              pointerEvents: "all",
              boxShadow: "0 2px 6px rgba(74,60,30,.18)",
            }}
          >
            <IconEnter size={12} />
            Open
          </button>
        </EdgeLabelRenderer>
      ) : null}

      {d.label ? (
        <EdgeLabelRenderer>
          {/* The label is a click target for the edge: clicking it selects the edge,
              exactly as clicking the line does. */}
          <div
            className="nodrag nopan"
            onClick={(e) => {
              e.stopPropagation();
              d.onSelect?.();
            }}
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              background: "#fffdf8",
              padding: "1px 6px",
              borderRadius: 6,
              fontSize: 11,
              fontWeight: 600,
              color: selected ? SELECT : "#6b665a",
              cursor: "pointer",
              pointerEvents: "all",
            }}
          >
            {d.label}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

export const edgeTypes = { ft: FtEdge };
