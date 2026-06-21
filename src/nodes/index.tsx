import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { CSSProperties, MouseEvent } from "react";
import { DIMS } from "../layout";
import type { NodeData } from "../model";
import { IconEnter } from "../shell/icons";

// Custom React Flow node components. SHAPE encodes the node TYPE; COLOR (owner)
// is an orthogonal channel applied as an accent (docs/flow-mode.md).

// Handles are pure anchor points for the auto-routed edges (this is not an
// interactive connect-by-drag tool), so they are invisible. Each side carries
// BOTH a source and a target handle; layout() picks the side per edge from the
// dagre geometry so an edge attaches where it actually arrives (no wrap-under).
const handleStyle: CSSProperties = {
  width: 7,
  height: 7,
  background: "transparent",
  border: "none",
  opacity: 0,
};

const SIDES: { pos: Position; key: string }[] = [
  { pos: Position.Top, key: "top" },
  { pos: Position.Right, key: "right" },
  { pos: Position.Bottom, key: "bottom" },
  { pos: Position.Left, key: "left" },
];

const TEXT = "#2A2722";
const SHADOW = "0 1px 3px rgba(0,0,0,.07)";
// Selection = a gentle lift (scale + elevated shadow), NOT an outline ring.
// Applies equally to single selection and actor multi-select (same `selected`).
const SHADOW_SEL = "0 8px 22px rgba(74,60,30,.20)";
const SEL_TRANSITION = "transform .13s ease, box-shadow .13s ease";
const lift = (selected: boolean): CSSProperties => ({
  transform: selected ? "scale(1.045)" : "scale(1)",
  transformOrigin: "center",
  transition: SEL_TRANSITION,
});

function Handles() {
  return (
    <>
      {SIDES.flatMap((s) => [
        <Handle key={`t-${s.key}`} id={`t-${s.key}`} type="target" position={s.pos} style={handleStyle} />,
        <Handle key={`s-${s.key}`} id={`s-${s.key}`} type="source" position={s.pos} style={handleStyle} />,
      ])}
    </>
  );
}

function Label({ text }: { text: string }) {
  return <div style={{ fontSize: 13, fontWeight: 600, color: TEXT }}>{text}</div>;
}

/** Corner "Open" control shown on any node that drills down (sub-flow or sequence).
 *  `pos` overrides placement; `compact` = icon-only (for tight shapes like the
 *  decision diamond, where a text badge would collide with the centered label). */
function DrillBadge({ id, d, pos, compact }: { id: string; d: NodeData; pos?: CSSProperties; compact?: boolean }) {
  if (!d.drillTarget) return null;
  const canDrill = d.canDrill === true;
  const noun = d.drillKind === "sequence" ? "sequence" : "sub-flow";
  const open = (e: MouseEvent) => {
    e.stopPropagation();
    if (canDrill && d.drillTarget) d.onDrill?.(d.drillTarget, { kind: "node", id });
  };
  return (
    <button
      className="nodrag"
      onClick={open}
      disabled={!canDrill}
      title={canDrill ? `Open ${noun}: ${d.drillTarget}` : `${noun} '${d.drillTarget}' not found in workspace`}
      style={{
        position: "absolute",
        top: 6,
        right: 6,
        ...pos,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 3,
        padding: compact ? 0 : "2px 6px 2px 5px",
        width: compact ? 24 : undefined,
        height: compact ? 24 : undefined,
        border: `1px solid ${canDrill ? `${d.color}66` : "#e0d9cc"}`,
        borderRadius: compact ? 7 : 6,
        background: canDrill ? `${d.color}14` : "#f4f1ea",
        color: canDrill ? d.color : "#b8b1a2",
        fontSize: 10.5,
        fontWeight: 600,
        fontFamily: "inherit",
        cursor: canDrill ? "pointer" : "not-allowed",
        lineHeight: 1,
      }}
    >
      <IconEnter size={compact ? 13 : 12} />
      {compact ? null : "Open"}
    </button>
  );
}

export function TerminalNode({ data, selected }: NodeProps) {
  const d = data as NodeData;
  return (
    <div
      style={{
        width: DIMS.terminal.w,
        height: DIMS.terminal.h,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#efeadf",
        border: "1px solid #d8d1c2",
        borderRadius: 999,
        fontSize: 13,
        fontWeight: 700,
        color: "#4a463d",
        boxSizing: "border-box",
        boxShadow: selected ? SHADOW_SEL : "none",
        ...lift(selected),
      }}
    >
      <Handles />
      {d.label}
    </div>
  );
}

export function StepNode({ id, data, selected }: NodeProps) {
  const d = data as NodeData;
  // Rule: a drillable node (has a drill target) gets the SUB-FLOW treatment —
  // a full owner-color border + glow halo, and NO left stripe (the full border
  // already carries the color). A plain step keeps the 1px box + left stripe.
  const drillable = !!d.drillTarget;
  const border = drillable
    ? { border: `2px solid ${d.color}` }
    : { border: "1px solid #e8e2d6", borderLeft: `4px solid ${d.color}` };
  const halo = drillable ? `0 0 0 3px ${d.color}22, ` : "";
  return (
    <div
      style={{
        width: DIMS.step.w,
        minHeight: DIMS.step.h,
        background: "#fff",
        ...border,
        borderRadius: 10,
        boxShadow: `${halo}${selected ? SHADOW_SEL : SHADOW}`,
        ...lift(selected),
        padding: "9px 12px",
        boxSizing: "border-box",
        position: "relative",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
      }}
    >
      <Handles />
      <DrillBadge id={id} d={d} />
      <div style={{ paddingRight: d.drillTarget ? 44 : 0 }}>
        <Label text={d.label} />
      </div>
    </div>
  );
}

export function SubflowNode({ id, data, selected }: NodeProps) {
  const d = data as NodeData;
  return (
    <div
      style={{
        width: DIMS.subflow.w,
        minHeight: DIMS.subflow.h,
        background: "#fff",
        border: `2px solid ${d.color}`,
        borderRadius: 10,
        boxShadow: selected ? `0 0 0 3px ${d.color}22, ${SHADOW_SEL}` : `0 0 0 3px ${d.color}22, ${SHADOW}`,
        ...lift(selected),
        padding: "9px 12px 9px 12px",
        boxSizing: "border-box",
        position: "relative",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
      }}
    >
      <Handles />
      {/* Double border = "this is a sub-flow"; the badge is the drill action. */}
      <DrillBadge id={id} d={d} />
      <div style={{ paddingRight: 44 }}>
        <Label text={d.label} />
      </div>
    </div>
  );
}

export function DecisionNode({ id, data, selected }: NodeProps) {
  const d = data as NodeData;
  const s = DIMS.decision.w;
  // Drillable decision → full owner-color border + glow halo (like a sub-flow);
  // a plain decision keeps the two-left-edges accent.
  const drillable = !!d.drillTarget;
  const diamondBorder = drillable
    ? { borderTop: `2.5px solid ${d.color}`, borderRight: `2.5px solid ${d.color}`, borderBottom: `2.5px solid ${d.color}`, borderLeft: `2.5px solid ${d.color}` }
    : { borderTop: "1.5px solid #e8e2d6", borderRight: "1.5px solid #e8e2d6", borderBottom: `4px solid ${d.color}`, borderLeft: `4px solid ${d.color}` };
  const halo = drillable ? `0 0 0 3px ${d.color}22, ` : "";
  return (
    <div style={{ width: s, height: s, position: "relative", ...lift(selected) }}>
      <Handles />
      <div
        style={{
          position: "absolute",
          inset: 18,
          transform: "rotate(45deg)",
          background: "#fff",
          // After rotate(45°) the square's left+bottom borders map to the diamond's
          // two left edges (the accent); a drillable one colors all four.
          ...diamondBorder,
          borderRadius: 8,
          boxShadow: `${halo}${selected ? SHADOW_SEL : SHADOW}`,
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 16,
          textAlign: "center",
          fontSize: 12,
          fontWeight: 600,
          color: TEXT,
        }}
      >
        {d.label}
      </div>
      {/* Diamond center holds the label; its bounding-box corners are empty. Use an
          icon-only drill control in the top-right corner so it never collides. */}
      <DrillBadge id={id} d={d} compact pos={{ top: 4, right: 4 }} />
    </div>
  );
}

export function IoNode({ data, selected }: NodeProps) {
  const d = data as NodeData;
  return (
    <div style={{ width: DIMS.io.w, height: DIMS.io.h, position: "relative", ...lift(selected) }}>
      <Handles />
      <div
        style={{
          position: "absolute",
          inset: 0,
          transform: "skewX(-12deg)",
          background: "#fff",
          border: "1px solid #e8e2d6",
          borderLeft: `4px solid ${d.color}`,
          borderRadius: 6,
          boxShadow: selected ? SHADOW_SEL : SHADOW,
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 13,
          fontWeight: 600,
          color: TEXT,
        }}
      >
        {d.label}
      </div>
    </div>
  );
}

export const nodeTypes = {
  terminal: TerminalNode,
  step: StepNode,
  decision: DecisionNode,
  subflow: SubflowNode,
  io: IoNode,
};
