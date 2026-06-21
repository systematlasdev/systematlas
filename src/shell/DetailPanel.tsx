import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from "react";
import type { Actor, ExternalRef, FlowEdge, FlowNode, IoField, SequenceCall, SourceRef } from "../model";
import { EDGE_TYPE_LABEL, TYPE_LABEL, tokens } from "../tokens";
import { IconCallee, IconCaller, IconChevronLeft, IconChevronRight, IconClose, IconEmptyCard, IconEnter, IconSource } from "./icons";

const CALLER = "#3C6E91";
const CALLEE = "#BE7A2A";
const REUSE = "#5E54A8";

/** Caller/callee/occurrence relationship for the selected call (sequence view). */
export interface CallPeers {
  caller: SequenceCall | null;
  callees: SequenceCall[];
  occurrences: { id: string; index: number; call: SequenceCall | null }[];
}

function PeerPill({ icon, color, label, onClick }: { icon: ReactNode; color: string; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title={label}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        maxWidth: "100%",
        padding: "5px 11px 5px 8px",
        background: `${color}14`,
        border: `1px solid ${color}40`,
        borderRadius: 999,
        fontSize: 12,
        color: tokens.color.text,
        cursor: "pointer",
        fontFamily: "inherit",
      }}
    >
      <span style={{ display: "flex", color, flex: "0 0 auto" }}>{icon}</span>
      <span style={{ fontFamily: tokens.font.mono, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>
    </button>
  );
}

export interface ActorView {
  id: string;
  label: string;
  kind: string;
  color: string;
  count: number; // steps this actor owns in the flow
  total: number; // total steps in the flow
}

interface DetailPanelProps {
  node: FlowNode | null;
  edge?: FlowEdge | null;
  call?: SequenceCall | null;
  /** Actor-id → Actor, to resolve a call's from/to labels (sequence view). */
  callActors?: Record<string, Actor>;
  /** Caller/callee + reuse occurrences of the selected call (sequence view). */
  callPeers?: CallPeers | null;
  /** Navigate to another call (select + scroll). */
  onNavigateCall?: (id: string) => void;
  ownerLabel?: string;
  ownerColor?: string;
  actor?: ActorView | null;
  open: boolean;
  onToggle: () => void;
  onDeselect: () => void;
  /** Whether the selected node's/edge's subflow target resolves in the workspace. */
  canDrill?: boolean;
  /** Drill into the selected node's/edge's subflow target. */
  onDrill?: (target: string) => void;
  /** Expanded panel width (px) + drag-to-resize start handler. */
  width?: number;
  onResizeStart?: (e: ReactPointerEvent) => void;
}

const sectionLabel: CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: tokens.color.faint,
};

function Pill({ bg, color, dot, k, v }: { bg: string; color: string; dot: string; k: string; v: string }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "4px 11px 4px 9px",
        background: bg,
        borderRadius: 999,
        fontSize: 12,
        color,
        whiteSpace: "nowrap",
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: 999, background: dot, flex: "0 0 auto" }} />
      {k ? <span style={{ opacity: 0.7, fontWeight: 500 }}>{k}</span> : null}
      <span style={{ fontWeight: 600 }}>{v}</span>
    </span>
  );
}

function IoSection({ title, items }: { title: string; items?: IoField[] }) {
  if (!items?.length) return null;
  return (
    <>
      <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase", color: tokens.color.faint2, margin: "0 0 6px 2px" }}>
        {title}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 1, marginBottom: 12 }}>
        {items.map((f, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "7px 10px", background: tokens.color.field, borderRadius: 7 }}>
            <span style={{ fontFamily: tokens.font.mono, fontSize: 12.5, color: tokens.color.text }}>{f.name}</span>
            {f.type ? <span style={{ fontFamily: tokens.font.mono, fontSize: 11.5, color: "#A39A82" }}>{f.type}</span> : null}
          </div>
        ))}
      </div>
    </>
  );
}

function sourceText(s: SourceRef): string {
  const parts: string[] = [];
  if (s.symbol) parts.push(s.symbol);
  if (s.file) parts.push(`${s.file}${s.line ? `:${s.line}` : ""}`);
  return parts.join(" · ") || "—";
}

function Header({ kicker, title, onDeselect, onToggle }: { kicker: string; title: string; onDeselect: () => void; onToggle: () => void }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", padding: "18px 14px 14px 20px", gap: 10 }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ ...sectionLabel, color: tokens.color.faint, marginBottom: 5 }}>{kicker}</div>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, lineHeight: 1.2, letterSpacing: "-0.015em", color: tokens.color.text }}>{title}</h2>
      </div>
      <div style={{ display: "flex", gap: 2, flex: "0 0 auto" }}>
        <button className="ft-quiet-soft" style={{ width: 30, height: 30, borderRadius: 7 }} title="Deselect" onClick={onDeselect}>
          <IconClose />
        </button>
        <button className="ft-quiet-soft" style={{ width: 30, height: 30, borderRadius: 7 }} title="Collapse panel" onClick={onToggle}>
          <IconChevronRight />
        </button>
      </div>
    </div>
  );
}

/** Description bullets + inputs/outputs + resources + source. Shared by node and
 *  edge selection (an edge is a first-class object with the same content). */
function ObjectContent({
  description,
  inputs,
  outputs,
  refs,
  source,
}: {
  description?: string[];
  inputs?: IoField[];
  outputs?: IoField[];
  refs?: ExternalRef[];
  source?: SourceRef;
}) {
  return (
    <>
      {description?.length ? (
        <ul style={{ margin: "0 0 20px", paddingLeft: 18, fontSize: 13.5, lineHeight: 1.55, color: tokens.color.textSecondary }}>
          {description.map((d, i) => (
            <li key={i} style={{ marginBottom: 5 }}>{d}</li>
          ))}
        </ul>
      ) : null}

      {inputs?.length || outputs?.length ? (
        <div style={{ marginBottom: 20 }}>
          <div style={{ ...sectionLabel, marginBottom: 10 }}>Inputs / Outputs</div>
          <IoSection title="In" items={inputs} />
          <IoSection title="Out" items={outputs} />
        </div>
      ) : null}

      {refs?.length ? (
        <div style={{ marginBottom: 20 }}>
          <div style={{ ...sectionLabel, marginBottom: 8 }}>Resources</div>
          {refs.map((r, i) => (
            <a key={i} href={r.url} target="_blank" rel="noreferrer" style={{ display: "block", fontSize: 12.5, color: tokens.color.violet, marginBottom: 4, textDecoration: "none" }}>
              {r.label}
            </a>
          ))}
        </div>
      ) : null}

      {source ? (
        <div style={{ display: "flex", alignItems: "center", gap: 7, paddingTop: 14, borderTop: `1px solid ${tokens.color.borderSoft}` }}>
          <span style={{ color: tokens.color.faint, display: "flex", opacity: 0.6 }}>
            <IconSource />
          </span>
          <span style={{ fontFamily: tokens.font.mono, fontSize: 11.5, color: tokens.color.faint }}>{sourceText(source)}</span>
        </div>
      ) : null}
    </>
  );
}

/** Drill-down footer — for subflow nodes, sequence-bearing nodes, and edges. */
function DrillFooter({ target, isSequence, canDrill, onDrill }: { target?: string; isSequence?: boolean; canDrill?: boolean; onDrill?: (t: string) => void }) {
  if (!target) return null;
  const noun = isSequence ? "sequence" : "sub-flow";
  return (
    <div style={{ flex: "0 0 auto", padding: "14px 20px", borderTop: `1px solid ${tokens.color.borderSoft}` }}>
      <button
        className="ft-primary"
        disabled={!canDrill}
        onClick={() => onDrill?.(target)}
        title={canDrill ? `Open ${noun}: ${target}` : `${noun} '${target}' not found in workspace`}
        style={{ gap: 8, width: "100%", height: 40, borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: canDrill ? "pointer" : "not-allowed", opacity: canDrill ? 1 : 0.55 }}
      >
        <IconEnter size={15} />
        {canDrill ? `Open ${noun}` : `${noun[0].toUpperCase()}${noun.slice(1)} not found`}
      </button>
      <div style={{ fontSize: 11.5, color: tokens.color.faint, textAlign: "center", marginTop: 7, fontFamily: tokens.font.mono }}>
        → {target}
      </div>
    </div>
  );
}

/** Expanded panel shell + a left-edge drag handle to resize the panel width. */
function PanelShell({ width, onResizeStart, children }: { width: number; onResizeStart?: (e: ReactPointerEvent) => void; children: ReactNode }) {
  return (
    <aside
      style={{
        flex: `0 0 ${width}px`,
        width,
        position: "relative",
        display: "flex",
        flexDirection: "column",
        background: tokens.color.panel,
        borderLeft: `1px solid ${tokens.color.border}`,
      }}
    >
      {onResizeStart ? (
        <div
          className="ft-resize"
          onPointerDown={onResizeStart}
          title="Drag to resize"
          style={{ position: "absolute", left: -3, top: 0, bottom: 0, width: 7, cursor: "col-resize", zIndex: 5 }}
        />
      ) : null}
      {children}
    </aside>
  );
}

export function DetailPanel({ node, edge, call, callActors, callPeers, onNavigateCall, ownerLabel, ownerColor, actor, open, onToggle, onDeselect, canDrill, onDrill, width = tokens.size.panel, onResizeStart }: DetailPanelProps) {
  if (!open) {
    return (
      <aside
        style={{
          flex: `0 0 ${tokens.size.panelRail}px`,
          width: tokens.size.panelRail,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          background: tokens.color.panel,
          borderLeft: `1px solid ${tokens.color.border}`,
          padding: "12px 0",
        }}
      >
        <button className="ft-quiet" style={{ width: 32, height: 32, borderRadius: 8 }} title="Expand panel" onClick={onToggle}>
          <IconChevronLeft />
        </button>
        <div
          style={{
            marginTop: 16,
            writingMode: "vertical-rl",
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: tokens.color.faint,
          }}
        >
          Details
        </div>
      </aside>
    );
  }

  // --- actor selection (via legend) ---
  if (actor) {
    return (
      <PanelShell width={width} onResizeStart={onResizeStart}>
        <Header kicker="Actor" title={actor.label} onDeselect={onDeselect} onToggle={onToggle} />
        <div style={{ flex: "1 1 auto", overflowY: "auto", padding: "0 20px 20px" }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginBottom: 18 }}>
            <Pill bg={`${actor.color}22`} color={tokens.color.textSecondary} dot={actor.color} k="kind" v={actor.kind} />
            <Pill bg={`${actor.color}22`} color={tokens.color.textSecondary} dot={actor.color} k="steps" v={String(actor.count)} />
          </div>
          <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55, color: tokens.color.textSecondary }}>
            Owns <strong>{actor.count}</strong> of {actor.total} step{actor.total === 1 ? "" : "s"} in this flow.
            All steps performed by {actor.label} are highlighted in the diagram.
          </p>
        </div>
      </PanelShell>
    );
  }

  // --- edge selection (an edge is a first-class object) ---
  if (edge) {
    const title = edge.label || `${edge.from} → ${edge.to}`;
    return (
      <PanelShell width={width} onResizeStart={onResizeStart}>
        <Header kicker="Edge" title={title} onDeselect={onDeselect} onToggle={onToggle} />
        <div style={{ flex: "1 1 auto", overflowY: "auto", padding: "0 20px 20px" }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginBottom: 18 }}>
            <Pill bg={tokens.color.violetBg} color={tokens.color.violet} dot={tokens.color.violetDot} k="type" v={EDGE_TYPE_LABEL[edge.type] ?? edge.type} />
            {edge.shared ? <Pill bg="#EFEAF8" color={tokens.color.violet} dot={tokens.color.violetDot} k="" v="@shared" /> : null}
          </div>
          <div style={{ fontFamily: tokens.font.mono, fontSize: 12, color: tokens.color.faint, marginBottom: 18 }}>
            {edge.from} → {edge.to}
          </div>
          <ObjectContent description={edge.description} inputs={edge.inputs} outputs={edge.outputs} refs={edge.refs} source={edge.source} />
        </div>
        <DrillFooter target={edge.subflow ?? edge.sequence} isSequence={!edge.subflow && !!edge.sequence} canDrill={canDrill} onDrill={onDrill} />
      </PanelShell>
    );
  }

  // --- call selection (sequence view) ---
  if (call) {
    const fromLabel = call.from ? (callActors?.[call.from]?.label ?? call.from) : "entry";
    const toLabel = callActors?.[call.to]?.label ?? call.to;
    const kv = (k: string, v: string) => (
      <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: tokens.color.faint2, flex: "0 0 64px", paddingTop: 1 }}>{k}</span>
        <span style={{ fontFamily: tokens.font.mono, fontSize: 12, color: tokens.color.textSecondary, wordBreak: "break-word" }}>{v}</span>
      </div>
    );
    return (
      <PanelShell width={width} onResizeStart={onResizeStart}>
        <Header kicker="Call" title={call.method} onDeselect={onDeselect} onToggle={onToggle} />
        <div style={{ flex: "1 1 auto", overflowY: "auto", padding: "0 20px 20px" }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginBottom: 16 }}>
            {call.async ? <Pill bg={tokens.color.violetBg} color={tokens.color.violet} dot={tokens.color.violetDot} k="" v="async" /> : null}
            {call.returnType ? <Pill bg={tokens.color.field} color={tokens.color.textSecondary} dot={tokens.color.faint} k="returns" v={call.returnType} /> : null}
          </div>
          <div style={{ fontFamily: tokens.font.mono, fontSize: 12, color: tokens.color.faint, marginBottom: 16 }}>
            {fromLabel} → {toLabel}
          </div>
          <ObjectContent description={call.description} inputs={call.params} outputs={call.returns} refs={call.refs} source={call.source} />
          {call.request || call.response ? (
            <div style={{ marginTop: 4, marginBottom: 20 }}>
              <div style={{ ...sectionLabel, marginBottom: 8 }}>Wire</div>
              {call.request ? kv("req", call.request) : null}
              {call.response ? kv("resp", call.response) : null}
            </div>
          ) : null}

          {/* caller / callee navigation */}
          {callPeers ? (
            <>
              <div style={{ marginBottom: 16 }}>
                <div style={{ ...sectionLabel, marginBottom: 8 }}>Called by</div>
                {callPeers.caller ? (
                  <PeerPill icon={<IconCaller size={13} />} color={CALLER} label={callPeers.caller.method} onClick={() => onNavigateCall?.(callPeers.caller!.id)} />
                ) : (
                  <span style={{ fontSize: 12.5, color: tokens.color.faint }}>— entry / top-level</span>
                )}
              </div>
              <div style={{ marginBottom: callPeers.occurrences.length ? 16 : 0 }}>
                <div style={{ ...sectionLabel, marginBottom: 8 }}>Calls ({callPeers.callees.length})</div>
                {callPeers.callees.length ? (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {callPeers.callees.map((c) => (
                      <PeerPill key={c.id} icon={<IconCallee size={13} />} color={CALLEE} label={c.method} onClick={() => onNavigateCall?.(c.id)} />
                    ))}
                  </div>
                ) : (
                  <span style={{ fontSize: 12.5, color: tokens.color.faint }}>— leaf</span>
                )}
              </div>
              {callPeers.occurrences.length ? (
                <div>
                  <div style={{ ...sectionLabel, marginBottom: 8 }}>Reused ×{callPeers.occurrences.length}</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {callPeers.occurrences.map((o) => (
                      <button
                        key={o.id}
                        onClick={() => onNavigateCall?.(o.id)}
                        title={o.call?.method ?? o.id}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                          padding: "5px 11px",
                          background: o.id === call.id ? `${REUSE}22` : `${REUSE}10`,
                          border: `1px solid ${REUSE}${o.id === call.id ? "" : "33"}`,
                          borderRadius: 999,
                          fontSize: 12,
                          fontWeight: o.id === call.id ? 700 : 500,
                          color: REUSE,
                          cursor: "pointer",
                          fontFamily: "inherit",
                        }}
                      >
                        #{o.index}
                        {o.call?.phase ? <span style={{ opacity: 0.6, fontWeight: 500 }}>· {o.call.phase}</span> : null}
                      </button>
                    ))}
                  </div>
                  <div style={{ fontSize: 11.5, color: tokens.color.faint, marginTop: 7, lineHeight: 1.45 }}>
                    Same method appears at {callPeers.occurrences.length} call-sites (matched by source / signature).
                  </div>
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      </PanelShell>
    );
  }

  // --- empty ---
  if (!node) {
    return (
      <PanelShell width={width} onResizeStart={onResizeStart}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 14px 14px 20px" }}>
          <span style={{ ...sectionLabel, color: tokens.color.muted2, fontSize: 12 }}>Details</span>
          <button className="ft-quiet-soft" style={{ width: 30, height: 30, borderRadius: 7 }} title="Collapse panel" onClick={onToggle}>
            <IconChevronRight />
          </button>
        </div>
        <div style={{ flex: "1 1 auto", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, padding: "24px 32px", textAlign: "center" }}>
          <div style={{ width: 56, height: 56, borderRadius: 14, background: "#F7F3EA", border: `1px solid ${tokens.color.borderSoft}`, display: "flex", alignItems: "center", justifyContent: "center", color: "#C7BEA6" }}>
            <IconEmptyCard />
          </div>
          <div>
            <div style={{ fontSize: 14.5, fontWeight: 600, color: tokens.color.textSecondary, marginBottom: 4 }}>Select a node or edge</div>
            <div style={{ fontSize: 12.5, color: "#ABA597", lineHeight: 1.5 }}>
              Click any node or arrow — or an actor in the legend — to inspect it.
            </div>
          </div>
        </div>
      </PanelShell>
    );
  }

  // --- node selection ---
  return (
    <PanelShell width={width} onResizeStart={onResizeStart}>
      <Header kicker="Node" title={node.label} onDeselect={onDeselect} onToggle={onToggle} />
      <div style={{ flex: "1 1 auto", overflowY: "auto", padding: "0 20px 20px" }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginBottom: 18 }}>
          <Pill bg={tokens.color.violetBg} color={tokens.color.violet} dot={tokens.color.violetDot} k="type" v={TYPE_LABEL[node.type] ?? node.type} />
          {ownerLabel && ownerColor ? (
            <Pill bg={`${ownerColor}22`} color={tokens.color.textSecondary} dot={ownerColor} k="owner" v={ownerLabel} />
          ) : null}
          {node.shared ? <Pill bg="#EFEAF8" color={tokens.color.violet} dot={tokens.color.violetDot} k="" v="@shared" /> : null}
        </div>
        <ObjectContent description={node.description} inputs={node.inputs} outputs={node.outputs} refs={node.refs} source={node.source} />
      </div>
      <DrillFooter
        target={(node.type === "subflow" ? node.subflow : undefined) ?? node.sequence}
        isSequence={node.type !== "subflow" && !!node.sequence}
        canDrill={canDrill}
        onDrill={onDrill}
      />
    </PanelShell>
  );
}
