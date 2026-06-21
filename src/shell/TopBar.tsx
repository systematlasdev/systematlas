import { tokens } from "../tokens";
import { BRAND } from "../brand";
import {
  IconChevronRight,
  IconFlowKind,
  IconHeightAdjust,
  IconReset,
  IconSeqKind,
  IconWidthAdjust,
  Logo,
} from "./icons";

export type Tab = "flow" | "sequence";

export interface Crumb {
  id: string;
  title: string;
}

/** Sequence-only sizing controls (shown when the active document is a sequence). */
export interface SeqControls {
  laneGap: number;
  rowH: number;
  /** Current total diagram width (px), shown next to the width slider. */
  width: number;
  bounds: { lane: [number, number]; row: [number, number] };
  onLaneGap: (v: number) => void;
  onRowH: (v: number) => void;
  onReset: () => void;
}

interface TopBarProps {
  /** Drill-down path (root → current). Last segment is the active flow. */
  trail: Crumb[];
  onCrumb: (index: number) => void;
  /** Active altitude — reflects the current document's kind (read-only indicator). */
  tab: Tab;
  /** Present only for sequence documents. */
  seq?: SeqControls;
}

const divider = (
  <div style={{ width: 1, height: 20, background: tokens.color.border }} />
);

function SizeSlider({
  icon,
  title,
  value,
  min,
  max,
  suffix,
  onChange,
}: {
  icon: React.ReactNode;
  title: string;
  value: number;
  min: number;
  max: number;
  suffix?: string;
  onChange: (v: number) => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }} title={title}>
      <span style={{ color: tokens.color.muted, display: "flex", flex: "0 0 auto" }}>{icon}</span>
      <input
        className="ft-range"
        type="range"
        min={min}
        max={max}
        value={Math.round(value)}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ width: 84 }}
      />
      {suffix ? (
        <span style={{ fontSize: 11, fontVariantNumeric: "tabular-nums", color: tokens.color.muted, minWidth: 38 }}>{suffix}</span>
      ) : null}
    </div>
  );
}

export function TopBar({ trail, onCrumb, tab, seq }: TopBarProps) {
  return (
    <header
      style={{
        flex: "0 0 auto",
        height: tokens.size.topbar,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 14px 0 16px",
        background: tokens.color.topbar,
        borderBottom: `1px solid ${tokens.color.border}`,
        gap: 16,
      }}
    >
      {/* left */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <Logo size={24} />
          <span
            style={{
              fontFamily: tokens.font.mono,
              fontSize: 13.5,
              fontWeight: 600,
              letterSpacing: "-0.02em",
              color: tokens.color.text,
            }}
          >
            {BRAND.display}
          </span>
        </div>
        {divider}
        {/* Breadcrumb = drill-down path. Click a segment to go back up a level. */}
        <nav style={{ display: "flex", alignItems: "center", gap: 2, minWidth: 0 }}>
          {trail.map((c, i) => {
            const isLast = i === trail.length - 1;
            return (
              <div key={c.id + i} style={{ display: "flex", alignItems: "center", gap: 2, minWidth: 0 }}>
                {i > 0 ? (
                  <span style={{ color: tokens.color.faint, display: "flex", flex: "0 0 auto" }}>
                    <IconChevronRight size={13} />
                  </span>
                ) : null}
                <button
                  className="ft-quiet"
                  onClick={() => (isLast ? undefined : onCrumb(i))}
                  disabled={isLast}
                  title={c.title}
                  style={{
                    height: 30,
                    padding: "0 8px",
                    borderRadius: 8,
                    minWidth: 0,
                    cursor: isLast ? "default" : "pointer",
                  }}
                >
                  <span
                    style={{
                      fontSize: 13.5,
                      fontWeight: isLast ? 600 : 500,
                      color: isLast ? tokens.color.text : tokens.color.textSecondary,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      maxWidth: 220,
                    }}
                  >
                    {c.title}
                  </span>
                </button>
              </div>
            );
          })}
        </nav>
      </div>

      {/* right */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {tab === "sequence" && seq ? (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <SizeSlider
                icon={<IconWidthAdjust size={15} />}
                title="Diagram width — actor spacing"
                value={seq.laneGap}
                min={seq.bounds.lane[0]}
                max={seq.bounds.lane[1]}
                suffix={`${Math.round(seq.width)}px`}
                onChange={seq.onLaneGap}
              />
              <SizeSlider
                icon={<IconHeightAdjust size={15} />}
                title="Diagram height — row spacing"
                value={seq.rowH}
                min={seq.bounds.row[0]}
                max={seq.bounds.row[1]}
                onChange={seq.onRowH}
              />
              <button className="ft-quiet" style={{ width: 30, height: 30, borderRadius: 8 }} title="Reset size to fit" onClick={seq.onReset}>
                <IconReset size={15} />
              </button>
            </div>
            {divider}
          </>
        ) : null}
        {/* Altitude indicator — read-only. The active level is driven by drill-down
            (Flow → Sequence), not a toggle, so this reflects state rather than switching it. */}
        <div
          title={tab === "sequence" ? "Sequence altitude (low level)" : "Flow altitude (high level)"}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 7,
            padding: "5px 11px",
            background: "#ECE5D7",
            borderRadius: 9,
            fontSize: 13,
            fontWeight: 600,
            color: tokens.color.text,
            userSelect: "none",
          }}
        >
          <span style={{ display: "flex", color: tokens.color.muted }}>
            {tab === "sequence" ? <IconSeqKind size={15} /> : <IconFlowKind size={15} />}
          </span>
          {tab === "sequence" ? "Sequence" : "Flow"}
        </div>
      </div>
    </header>
  );
}
