import { useEffect, useMemo, useRef, useState } from "react";
import type { SequenceCall, SequenceDocument } from "../core/sequence-types";
import { buildActorColors, NEUTRAL } from "../theme";
import { tokens } from "../tokens";
import { IconCallee, IconCaller } from "../shell/icons";
import { arrowHead, laneX, SEQ } from "./geometry";
import { buildSequence, type SeqRow } from "./layout";

/** Truncate an actor label to fit the (possibly shrunk) header box width. */
function fitLabel(label: string, boxW: number): string {
  const max = Math.max(3, Math.floor((boxW - 16) / 7.2));
  return label.length > max ? `${label.slice(0, Math.max(3, max - 1))}…` : label;
}

const SELECT = "#2D2A24"; // reserved selection ink (outside the actor palette)
const EDGE = "#9a9384";
const TEXT = "#2A2722";
const CALLER = "#3C6E91"; // steel blue — "calls the selected"
const CALLEE = "#BE7A2A"; // amber/bronze — "called by the selected"
const REUSE = "#5E54A8"; // violet — reuse (same identity as @shared)
const ACT_HW = 5; // activation-bar half width (the bar rect is 2·ACT_HW wide, centered on its inset x)

/** X of an activation bar's centre on a lifeline, given its per-lifeline inset. */
function barX(lane: number, inset: number): number {
  return lane + inset * SEQ.depthInset;
}

function Message({
  row,
  width,
  laneGap,
  actorIndex,
  colors,
  selected,
  onSelect,
  onHover,
}: {
  row: SeqRow;
  width: number;
  laneGap: number;
  actorIndex: Record<string, number>;
  colors: Record<string, string>;
  selected: boolean;
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
}) {
  const c = row.call;
  const toIdx = actorIndex[c.to] ?? 0;
  const fromIdx = c.from != null ? actorIndex[c.from] : undefined;
  const isEntry = fromIdx == null;
  const yc = row.yc;

  // Full-row hit area — the whole row selects this call (robust, row-like).
  const hit = (
    <rect
      x={0}
      y={row.y}
      width={width}
      height={row.h}
      fill="transparent"
      style={{ cursor: "pointer" }}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(c.id);
      }}
      onMouseEnter={() => onHover(c.id)}
      onMouseLeave={() => onHover(null)}
    />
  );

  // --- return row: dashed reply back from callee → caller ---
  if (row.kind === "return") {
    const fromLane = laneX(fromIdx as number, laneGap);
    const toLane = laneX(toIdx, laneGap);
    const dir = fromLane > toLane ? 1 : -1; // arrow points toward the caller
    // Start at the callee bar's edge, land on the caller bar's edge (fall back to the
    // bare lifeline when that side has no bar).
    const startX = row.toInset != null ? barX(toLane, row.toInset) + dir * ACT_HW : toLane;
    const headX = row.fromInset != null ? barX(fromLane, row.fromInset) - dir * ACT_HW : fromLane;
    const col = selected ? SELECT : colors[c.to] ?? EDGE;
    const label = c.returnType ?? (c.returns?.length ? c.returns.map((r) => r.name).join(", ") : "");
    return (
      <g>
        <line
          x1={startX}
          y1={yc}
          x2={headX - dir * SEQ.ahead}
          y2={yc}
          stroke={col}
          strokeWidth={selected ? 2 : 1.3}
          strokeDasharray="5 4"
          strokeOpacity={selected ? 1 : 0.8}
        />
        <polygon points={arrowHead(headX, yc, dir > 0 ? 1 : -1)} fill={col} fillOpacity={selected ? 1 : 0.8} />
        {label ? (
          <text
            x={(startX + headX) / 2}
            y={yc - 5}
            textAnchor="middle"
            fontSize={10.5}
            fontStyle="italic"
            fontWeight={selected ? 700 : 500}
            fill={tokens.color.muted}
            style={{ pointerEvents: "none", userSelect: "none" }}
          >
            {label}
          </text>
        ) : null}
        {hit}
      </g>
    );
  }

  // --- forward message ---
  const toLane = laneX(toIdx, laneGap);
  const self = !isEntry && fromIdx === toIdx;
  // Direction the arrow points (+1 right, -1 left). Entry calls always point right
  // (they come from a short stub to the left of the first lifeline).
  const dir = isEntry || self ? 1 : toLane >= laneX(fromIdx as number, laneGap) ? 1 : -1;
  // Land on the callee bar's edge (the call activates the callee), else the lifeline.
  const x2 = row.toInset != null ? barX(toLane, row.toInset) - dir * ACT_HW : toLane;
  // Entry calls (no `from` actor) start at a FIXED short stub before the first
  // lifeline — not a laneGap fraction, which goes negative (off-canvas) on wide
  // diagrams. Clamped to stay inside the viewport.
  const ENTRY_STUB = 56;
  let x1: number;
  if (isEntry) {
    x1 = Math.max(8, x2 - ENTRY_STUB);
  } else {
    const fromLane = laneX(fromIdx as number, laneGap);
    // Leave from the caller bar's edge facing the callee (fall back to the lifeline).
    x1 = row.fromInset != null ? barX(fromLane, row.fromInset) + dir * ACT_HW : fromLane;
  }
  const col = selected ? SELECT : c.from ? (colors[c.from] ?? EDGE) : EDGE;
  const sw = selected ? 2.4 : 1.6;
  const dash = c.async ? "7 4" : undefined;

  const label = c.returnType ? `${c.method} → ${c.returnType}` : c.method;
  const labelX = self ? x1 + SEQ.selfW + 8 : (x1 + x2) / 2;
  const labelAnchor = self ? "start" : "middle";

  return (
    <g>
      {self ? (
        <>
          <path
            d={`M ${x1} ${yc - 8} h ${SEQ.selfW} v 16 h -${SEQ.selfW}`}
            fill="none"
            stroke={col}
            strokeWidth={sw}
            strokeDasharray={dash}
            strokeLinejoin="round"
          />
          <polygon points={arrowHead(x1, yc + 8, -1)} fill={col} />
        </>
      ) : (
        <>
          <line
            x1={x1}
            y1={yc}
            x2={x2 - dir * SEQ.ahead}
            y2={yc}
            stroke={col}
            strokeWidth={sw}
            strokeDasharray={dash}
          />
          <polygon points={arrowHead(x2, yc, dir)} fill={col} />
        </>
      )}
      <text
        x={labelX}
        y={yc - 8}
        textAnchor={labelAnchor}
        fontSize={12}
        fontWeight={selected ? 800 : 600}
        fill={TEXT}
        style={{ pointerEvents: "none", userSelect: "none" }}
      >
        {label}
      </text>
      {hit}
    </g>
  );
}

export function SequenceCanvas({
  doc,
  laneGap,
  rowH,
  selectedId,
  reuseCount,
  occIndex,
  callerId,
  calleeIds,
  scrollToId,
  scrollNonce,
  onSelectCall,
  onNavigate,
  onPaneClick,
}: {
  doc: SequenceDocument;
  laneGap: number;
  rowH: number;
  selectedId: string | null;
  /** call id → number of occurrences (only for reused methods, ≥2). */
  reuseCount: Map<string, number>;
  /** call id → occurrence index (1-based), for the selected reused method. */
  occIndex: Map<string, number>;
  /** Caller (tree parent) of the selected call. */
  callerId: string | null;
  /** Callees (children) of the selected call. */
  calleeIds: Set<string>;
  /** Scroll this call's row into view when scrollNonce changes (navigation). */
  scrollToId: string | null;
  scrollNonce: number;
  onSelectCall: (id: string) => void;
  onNavigate: (id: string) => void;
  onPaneClick: () => void;
}) {
  const colors = useMemo(() => buildActorColors(doc.actors), [doc]);
  const layout = useMemo(() => buildSequence(doc, { laneGap, rowH }), [doc, laneGap, rowH]);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const vpRef = useRef<HTMLDivElement>(null);

  const contentH = SEQ.headerH + layout.height;
  const callRows = useMemo(() => layout.rows.filter((r) => r.kind === "call"), [layout]);
  // y-center (body coords) per call id, for scroll-to navigation + rail occ dots.
  const ycById = useMemo(() => {
    const m = new Map<string, number>();
    callRows.forEach((r) => m.set(r.call.id, r.yc));
    return m;
  }, [callRows]);

  // Scroll a navigated call's row into view (pill / occurrence / rail click).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !scrollToId) return;
    const yc = ycById.get(scrollToId);
    if (yc == null) return;
    el.scrollTo({ top: Math.max(0, SEQ.headerH + yc - el.clientHeight / 2), behavior: "smooth" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollNonce]);

  // Keep the minimap viewport rect in sync with the scroll position (imperative,
  // no re-render per scroll frame).
  const syncViewport = () => {
    const el = scrollRef.current;
    const vp = vpRef.current;
    if (!el || !vp) return;
    const sh = el.scrollHeight || 1;
    vp.style.top = `${(el.scrollTop / sh) * 100}%`;
    vp.style.height = `${(el.clientHeight / sh) * 100}%`;
  };
  useEffect(syncViewport, [layout]);

  const jumpFromRail = (e: React.MouseEvent) => {
    const el = scrollRef.current;
    if (!el) return;
    const r = e.currentTarget.getBoundingClientRect();
    const frac = (e.clientY - r.top) / r.height;
    el.scrollTo({ top: Math.max(0, frac * el.scrollHeight - el.clientHeight / 2), behavior: "smooth" });
  };

  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", background: tokens.color.canvas }}>
      {/* minimap rail — ticks per call row + a viewport rect; click to jump */}
      <div
        onClick={jumpFromRail}
        title="Jump"
        style={{
          flex: `0 0 ${SEQ.railW}px`,
          width: SEQ.railW,
          position: "relative",
          background: "#EFEADF",
          borderRight: `1px solid ${tokens.color.border}`,
          cursor: "pointer",
          overflow: "hidden",
        }}
      >
        {callRows.map((r) => (
          <div
            key={`mm-${r.call.id}`}
            style={{
              position: "absolute",
              left: 5,
              right: 5,
              height: 2,
              borderRadius: 1,
              top: `${((SEQ.headerH + r.yc) / contentH) * 100}%`,
              background: colors[r.call.from ?? ""] ?? NEUTRAL,
              opacity: r.call.id === selectedId ? 1 : 0.5,
            }}
          />
        ))}
        <div
          ref={vpRef}
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            background: "rgba(94,84,168,0.16)",
            borderTop: `1px solid ${tokens.color.violet}`,
            borderBottom: `1px solid ${tokens.color.violet}`,
            pointerEvents: "none",
          }}
        />
        {/* occurrence dots of the selected reused method — numbered, click to jump */}
        {[...occIndex.entries()].map(([id, n]) => {
          const yc = ycById.get(id);
          if (yc == null) return null;
          return (
            <div
              key={`od-${id}`}
              title={`occurrence ${n}`}
              onClick={(e) => {
                e.stopPropagation();
                onNavigate(id);
              }}
              style={{
                position: "absolute",
                left: "50%",
                transform: "translate(-50%,-50%)",
                top: `${((SEQ.headerH + yc) / contentH) * 100}%`,
                width: 15,
                height: 15,
                borderRadius: "50%",
                background: REUSE,
                color: "#fff",
                fontSize: 9,
                fontWeight: 700,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                border: "1px solid #fff",
                cursor: "pointer",
              }}
            >
              {n}
            </div>
          );
        })}
      </div>

      {/* scroll area: sticky actor header + scrolling body */}
      <div ref={scrollRef} onScroll={syncViewport} style={{ flex: "1 1 auto", overflow: "auto", position: "relative" }}>
        {/* sticky actor header (square-ish box, owner accent along the bottom) */}
        <div style={{ position: "sticky", top: 0, zIndex: 2, width: layout.width, height: SEQ.headerH, background: tokens.color.canvas, borderBottom: `1px solid ${tokens.color.borderSoft}` }}>
          <svg width={layout.width} height={SEQ.headerH} style={{ display: "block" }}>
            {doc.actors.map((a, i) => {
              const x = laneX(i, laneGap);
              const col = colors[a.id] ?? NEUTRAL;
              // Box shrinks with the lane gap (capped at actorBoxW) so lanes can pack tight.
              const bw = Math.max(SEQ.actorBoxMinW, Math.min(SEQ.actorBoxW, laneGap - SEQ.actorBoxGap));
              const bh = SEQ.actorBoxH;
              const ah = SEQ.actorAccentH;
              const bx = x - bw / 2;
              const by = 6;
              const label = fitLabel(a.label, bw);
              return (
                <g key={a.id}>
                  {/* lifeline stub connecting the box to the body lifeline below */}
                  <line x1={x} y1={by + bh} x2={x} y2={SEQ.headerH} stroke={col} strokeWidth={1.5} strokeOpacity={0.4} strokeDasharray="2 5" />
                  <rect x={bx} y={by} width={bw} height={bh} rx={3} fill="#fff" stroke={tokens.color.border} />
                  <rect x={bx + 1} y={by + bh - ah} width={bw - 2} height={ah} fill={col} />
                  <text x={x} y={by + bh / 2 + 3} textAnchor="middle" fontSize={12} fontWeight={700} fill="#4a463d" style={{ pointerEvents: "none", userSelect: "none" }}>
                    {label}
                    {label !== a.label ? <title>{a.label}</title> : null}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>

        <svg width={layout.width} height={layout.height} style={{ display: "block" }}>
          <rect width={layout.width} height={layout.height} fill="transparent" onClick={onPaneClick} />

          {/* row highlight bands (selected / hovered) */}
          {layout.rows.map((r) => {
            const sel = r.call.id === selectedId;
            const hov = r.call.id === hoverId;
            if (!sel && !hov) return null;
            return <rect key={`band-${r.kind}-${r.call.id}`} x={0} y={r.y} width={layout.width} height={r.h} fill={sel ? "rgba(45,42,36,0.07)" : "rgba(45,42,36,0.035)"} pointerEvents="none" />;
          })}

          {/* lifelines */}
          {doc.actors.map((a, i) => {
            const x = laneX(i, laneGap);
            const col = colors[a.id] ?? NEUTRAL;
            return <line key={a.id} x1={x} y1={0} x2={x} y2={layout.height - 12} stroke={col} strokeWidth={1.5} strokeOpacity={0.4} strokeDasharray="2 5" />;
          })}

          {/* phase separators */}
          {layout.seps.map((s) => {
            const yc = s.y + SEQ.sepH / 2;
            return (
              <g key={s.id}>
                <line x1={20} y1={yc} x2={layout.width - 16} y2={yc} stroke="#ddd5c6" strokeWidth={1} strokeDasharray="2 4" />
                <rect x={laneX(0, laneGap) - 56} y={yc - 9} width={112} height={18} rx={9} fill={tokens.color.canvas} />
                <text x={laneX(0, laneGap)} y={yc + 4} textAnchor="middle" fontSize={10} fontWeight={600} fill="#b0a892" style={{ pointerEvents: "none", userSelect: "none", letterSpacing: "0.08em" }}>
                  {s.label.toUpperCase()}
                </text>
              </g>
            );
          })}

          {/* activation bars (calls that nest children). Opaque white underlay so the
              dashed lifeline doesn't bleed through and read as a parallel "artifact". */}
          {layout.acts.map((a, i) => {
            const x = barX(laneX(a.actorIdx, laneGap), a.inset);
            const actor = doc.actors[a.actorIdx];
            const col = actor ? (colors[actor.id] ?? NEUTRAL) : NEUTRAL;
            const h = Math.max(2, a.y2 - a.y1);
            return (
              <g key={i}>
                <rect x={x - ACT_HW} y={a.y1} width={ACT_HW * 2} height={h} rx={2} fill="#FFFFFF" />
                <rect x={x - ACT_HW} y={a.y1} width={ACT_HW * 2} height={h} rx={2} fill={`${col}26`} stroke={col} strokeOpacity={0.55} />
              </g>
            );
          })}

          {/* left-gutter markers: caller/callee relationship + reuse ×N / occurrence # */}
          {callRows.map((r) => {
            const id = r.call.id;
            const yc = r.yc;
            const occ = occIndex.get(id);
            const n = reuseCount.get(id);
            const rel = id === callerId ? "caller" : calleeIds.has(id) ? "callee" : null;
            if (!occ && !n && !rel) return null;
            return (
              <g key={`mk-${id}`}>
                {rel ? (
                  <g>
                    <circle cx={24} cy={yc} r={9} fill={rel === "caller" ? CALLER : CALLEE} fillOpacity={0.16} />
                    <g transform={`translate(${24 - 7.2},${yc - 7.2})`} style={{ color: rel === "caller" ? CALLER : CALLEE }}>
                      {rel === "caller" ? <IconCaller size={14.4} /> : <IconCallee size={14.4} />}
                    </g>
                  </g>
                ) : null}
                {occ ? (
                  <g>
                    <circle cx={48} cy={yc} r={8} fill={REUSE} />
                    <text x={48} y={yc + 3} textAnchor="middle" fontSize={9} fontWeight={700} fill="#fff" style={{ pointerEvents: "none", userSelect: "none" }}>
                      {occ}
                    </text>
                  </g>
                ) : n ? (
                  <g>
                    <rect x={39} y={yc - 8} width={26} height={16} rx={8} fill={tokens.color.violetBg} />
                    <text x={52} y={yc + 3.5} textAnchor="middle" fontSize={10} fontWeight={700} fill={REUSE} style={{ pointerEvents: "none", userSelect: "none" }}>
                      ×{n}
                    </text>
                  </g>
                ) : null}
              </g>
            );
          })}

          {/* messages + return replies */}
          {layout.rows.map((r) => (
            <Message key={`${r.kind}-${r.call.id}`} row={r} width={layout.width} laneGap={laneGap} actorIndex={layout.actorIndex} colors={colors} selected={r.call.id === selectedId} onSelect={onSelectCall} onHover={setHoverId} />
          ))}
        </svg>
      </div>
    </div>
  );
}

/** Flatten the call tree (pre-order) — used by App to resolve a selected call. */
export function flattenCalls(calls: SequenceCall[]): SequenceCall[] {
  const out: SequenceCall[] = [];
  const walk = (cs: SequenceCall[]) => {
    for (const c of cs) {
      out.push(c);
      if (c.children?.length) walk(c.children);
    }
  };
  walk(calls);
  return out;
}
