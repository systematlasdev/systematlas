import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type EdgeProps } from "@xyflow/react";
import type { MouseEvent } from "react";
import type { DrillHandler, EdgeType } from "../model";
import { LABEL_MAX_W } from "../layout";
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
  /** Drill-down target: a sub-flow or a sequence (mirrors NodeData). */
  drillTarget?: string;
  drillKind?: "flow" | "sequence";
  canDrill?: boolean;
  onDrill?: DrillHandler;
  /** dagre-routed waypoints (avoid the nodes); set by layout(). */
  points?: { x: number; y: number }[];
  /** Source/target node boxes → clip each end to the node border (+gap) along the
   *  route, so the line leaves/enters facing where it heads, not a side-handle midpoint. */
  sourceBox?: { x: number; y: number; w: number; h: number };
  targetBox?: { x: number; y: number; w: number; h: number };
  /** dagre-computed label center (reserved space, clear of nodes). */
  labelXY?: { x: number; y: number };
  /** Select this edge (App-state selection) — called when its label is clicked. */
  onSelect?: () => void;
  [key: string]: unknown;
}

/** Point on the box border (inflated by `gap`) along the ray from the box CENTER
 *  toward `from` — i.e. where an edge approaching from `from`'s direction should end
 *  so its arrowhead sits just outside the node, facing inward (no grazing/crossing). */
function clipToBox(box: { x: number; y: number; w: number; h: number }, from: { x: number; y: number }, gap: number): { x: number; y: number } {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const dx = from.x - cx;
  const dy = from.y - cy;
  const left = box.x - gap;
  const right = box.x + box.w + gap;
  const top = box.y - gap;
  const bottom = box.y + box.h + gap;
  let t = Infinity;
  if (dx > 0) t = Math.min(t, (right - cx) / dx);
  else if (dx < 0) t = Math.min(t, (left - cx) / dx);
  if (dy > 0) t = Math.min(t, (bottom - cy) / dy);
  else if (dy < 0) t = Math.min(t, (top - cy) / dy);
  if (!Number.isFinite(t) || t <= 0) return from;
  return { x: cx + dx * t, y: cy + dy * t };
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

/** Drop intermediate points within `eps` px of the straight line between their
 *  neighbours — straightens near-collinear runs (dagre often nudges a midpoint a
 *  pixel or two off-axis, which roundedPath would otherwise render as a faint bow).
 *  Endpoints are always kept; real bends (e.g. a return detour) survive. */
function simplify(pts: { x: number; y: number }[], eps: number): { x: number; y: number }[] {
  if (pts.length <= 2) return pts;
  const out = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = out[out.length - 1];
    const b = pts[i];
    const c = pts[i + 1];
    const dx = c.x - a.x;
    const dy = c.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const dist = Math.abs((b.x - a.x) * dy - (b.y - a.y) * dx) / len;
    if (dist > eps) out.push(b);
  }
  out.push(pts[pts.length - 1]);
  return out;
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
    // the target).
    // Straighten first: collapse near-collinear waypoints so a straight edge draws as
    // a straight line (dagre nudges midpoints a pixel or two off-axis, which roundedPath
    // would otherwise render as a faint bow). This also sharpens the clip direction below,
    // since towardTarget/towardSource then reflect the real route, not a spurious jog.
    const pts = simplify(d.points.map((p) => ({ x: p.x, y: p.y })), 2.5);
    const GAP = 2;
    // Adjacent interior waypoints (captured before mutating the endpoints) give the
    // route direction each end should face.
    const towardTarget = pts[pts.length - 2];
    const towardSource = pts[1];
    // TARGET end: clip the arrowhead to the node border (+gap) along the approach, so
    // it ends just outside the box pointing inward — never grazing/crossing it.
    if (d.targetBox) {
      pts[pts.length - 1] = clipToBox(d.targetBox, towardTarget, 6);
    } else {
      const last = { x: targetX, y: targetY };
      const dx = last.x - towardTarget.x;
      const dy = last.y - towardTarget.y;
      const len = Math.hypot(dx, dy) || 1;
      pts[pts.length - 1] = len > GAP ? { x: last.x - (dx / len) * GAP, y: last.y - (dy / len) * GAP } : last;
    }
    // START end: leave from the node border (+small gap) toward the route, so the line
    // departs where it actually heads rather than snapping to a side-handle midpoint.
    if (d.sourceBox) {
      pts[0] = clipToBox(d.sourceBox, towardSource, GAP);
    } else {
      pts[0] = { x: sourceX, y: sourceY };
      const sdx = towardSource.x - pts[0].x;
      const sdy = towardSource.y - pts[0].y;
      const slen = Math.hypot(sdx, sdy) || 1;
      if (slen > GAP) pts[0] = { x: pts[0].x + (sdx / slen) * GAP, y: pts[0].y + (sdy / slen) * GAP };
    }
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

  const noun = d.drillKind === "sequence" ? "sequence" : "sub-flow";
  const openDrill = (e: MouseEvent) => {
    e.stopPropagation();
    if (d.canDrill && d.drillTarget) d.onDrill?.(d.drillTarget, { kind: "edge", id });
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

      {/* Drill control + label, stacked in ONE centered column. The always-visible
          drill icon sits above the label with a gap, so a tall multi-line label can
          never cover it. The drill control mirrors the node badge: a compact rounded
          icon, expanding to a full "Open" pill when the edge is selected; a dangling
          target (declared but not in the workspace) → disabled + explanatory tooltip. */}
      {d.drillTarget || d.label ? (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan"
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 5,
              pointerEvents: "none", // children opt back in individually
              zIndex: selected ? 5 : 1,
            }}
          >
            {d.drillTarget ? (
              <button
                className="nodrag nopan"
                onClick={openDrill}
                disabled={!d.canDrill}
                title={d.canDrill ? `Open ${noun}: ${d.drillTarget}` : `${noun} '${d.drillTarget}' not found in workspace`}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: selected ? 4 : 0,
                  padding: selected ? "3px 9px 3px 7px" : "3px 7px",
                  border: `1px solid ${d.canDrill ? SELECT : "#d9d2c4"}`,
                  borderRadius: 7,
                  background: d.canDrill ? (selected ? SELECT : "#fffdf8") : "#f4f1ea",
                  color: d.canDrill ? (selected ? "#fff" : SELECT) : "#b8b1a2",
                  fontSize: 11,
                  fontWeight: 600,
                  fontFamily: "inherit",
                  cursor: d.canDrill ? "pointer" : "not-allowed",
                  lineHeight: 1,
                  pointerEvents: "all",
                  boxShadow: "0 2px 6px rgba(74,60,30,.18)",
                  transition: "background .12s ease, color .12s ease",
                }}
              >
                <IconEnter size={12} />
                {selected ? "Open" : null}
              </button>
            ) : null}
            {d.label ? (
              // The label is a click target for the edge: a single click selects it
              // and a double-tap drills/centers — the same path as clicking the line.
              <div
                className="nodrag nopan"
                title={d.label}
                onClick={(e) => {
                  e.stopPropagation();
                  d.onSelect?.();
                }}
                style={{
                  maxWidth: LABEL_MAX_W,
                  whiteSpace: "normal",
                  overflowWrap: "break-word",
                  textAlign: "center",
                  lineHeight: 1.25,
                  background: "#fffdf8",
                  border: `1px solid ${selected ? SELECT : "#e7e1d4"}`,
                  padding: "2px 6px",
                  borderRadius: 6,
                  boxShadow: selected ? "0 2px 6px rgba(74,60,30,.18)" : "0 1px 2px rgba(74,60,30,.07)",
                  fontSize: 11,
                  fontWeight: 600,
                  color: selected ? SELECT : "#6b665a",
                  cursor: "pointer",
                  pointerEvents: "all",
                }}
              >
                {d.label}
              </div>
            ) : null}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

export const edgeTypes = { ft: FtEdge };
