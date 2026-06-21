// Sequence-diagram geometry. Layout constants mined from the engine-flow-visualizer
// prototype (lifelines at x = LEFT + i*LANE_GAP; one row per message).

export const SEQ = {
  laneGap: 210, // default x distance between actor lifelines (resizable, see SeqDims)
  left: 150, // left margin (first lifeline x)
  top: 14, // first row y (in body coords — the actor header is a separate sticky layer)
  rowH: 56, // default per-message row height (resizable)
  sepH: 34, // phase separator height
  botPad: 40,
  ahead: 9, // arrowhead size
  selfW: 34, // self-call loop width
  depthInset: 6, // activation-bar x offset per nesting depth
  headerH: 40, // sticky actor-header height (its own layer above the scrolling body)
  railW: 30, // left minimap rail width
  actorBoxW: 210, // actor header box max width (+40% over the original 150)
  actorBoxMinW: 60, // min width when lanes are compressed — label truncates to "Ord…"
  actorBoxGap: 16, // min horizontal gap kept between adjacent header boxes
  actorBoxH: 26,
  actorAccentH: 3, // horizontal owner-color accent along the box bottom
  // resize bounds (sliders in the top bar drive laneGap / rowH within these).
  // The header box now shrinks with the lane gap (label truncates), so lanes can
  // pack much tighter than the box's full width.
  minLaneGap: 80,
  maxLaneGap: 560,
  minRowH: 34,
  maxRowH: 120,
} as const;

/** Resizable spacing — horizontal (actor lanes) and vertical (message rows). */
export interface SeqDims {
  laneGap: number;
  rowH: number;
}

export const laneX = (i: number, laneGap: number = SEQ.laneGap): number => SEQ.left + i * laneGap;

/** Total diagram width for `n` actors at a given lane gap. */
export const seqWidth = (n: number, laneGap: number): number => SEQ.left * 2 + Math.max(0, n - 1) * laneGap;

/** Three points of a horizontal arrowhead pointing in `dir` (+1 right, -1 left). */
export function arrowHead(x: number, y: number, dir: 1 | -1): string {
  const a = SEQ.ahead;
  return `${x},${y} ${x - dir * a},${y - a * 0.7} ${x - dir * a},${y + a * 0.7}`;
}
