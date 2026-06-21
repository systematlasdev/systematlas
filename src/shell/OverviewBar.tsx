import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { tokens } from "../tokens";
import { IconChevronDown } from "./icons";

interface OverviewBarProps {
  /** Document-level overview paragraphs (optional). */
  overview?: string[];
  open: boolean;
  /** Expanded height (px). */
  height: number;
  onToggle: () => void;
  /** Drag the top edge to resize the height. */
  onResizeStart: (e: ReactPointerEvent) => void;
}

const label: CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: tokens.color.faint,
  flex: "0 0 auto",
};

export function OverviewBar({ overview, open, height, onToggle, onResizeStart }: OverviewBarProps) {
  const hint = overview?.length ? overview.join(" ") : "";

  // --- collapsed: thin bar with the label + a truncated hint ---
  if (!open) {
    return (
      <div
        onClick={onToggle}
        title="Expand overview"
        style={{
          flex: "0 0 auto",
          height: 38,
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "0 16px",
          background: tokens.color.panel,
          borderTop: `1px solid ${tokens.color.border}`,
          cursor: "pointer",
        }}
      >
        <span style={label}>Overview</span>
        {hint ? (
          <span
            style={{
              flex: "1 1 auto",
              minWidth: 0,
              fontSize: 12.5,
              color: tokens.color.textSecondary,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {hint}
          </span>
        ) : (
          <span style={{ flex: "1 1 auto" }} />
        )}
        <span style={{ flex: "0 0 auto", color: tokens.color.faint, display: "flex", transform: "rotate(180deg)" }}>
          <IconChevronDown size={15} />
        </span>
      </div>
    );
  }

  // --- expanded: hugs its content (no wasted space); the dragged `height` is a
  //     max cap, so long overviews scroll instead of pushing the canvas away. ---
  return (
    <aside
      style={{
        flex: "0 0 auto",
        position: "relative",
        display: "flex",
        flexDirection: "column",
        background: tokens.color.panel,
        borderTop: `1px solid ${tokens.color.border}`,
      }}
    >
      <div
        className="ft-resize-v"
        onPointerDown={onResizeStart}
        title="Drag to resize"
        style={{ position: "absolute", top: -3, left: 0, right: 0, height: 7, cursor: "row-resize", zIndex: 5 }}
      />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 16px 2px" }}>
        <span style={label}>Overview</span>
        <button className="ft-quiet-soft" style={{ width: 26, height: 26, borderRadius: 7 }} title="Collapse overview" onClick={onToggle}>
          <IconChevronDown size={15} />
        </button>
      </div>
      <div style={{ overflowY: "auto", maxHeight: height, padding: "0 16px 10px" }}>
        {overview?.length ? (
          overview.map((p, i) => (
            <p key={i} style={{ margin: i ? "5px 0 0" : 0, fontSize: 13, lineHeight: 1.45, color: tokens.color.textSecondary }}>
              {p}
            </p>
          ))
        ) : (
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.45, color: tokens.color.muted2 }}>
            No overview yet. Add an <code style={{ fontFamily: tokens.font.mono }}>overview</code> (array of paragraphs) to this
            document to describe its purpose here.
          </p>
        )}
      </div>
    </aside>
  );
}
