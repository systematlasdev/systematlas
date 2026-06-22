// SVG icons reused from the Claude Design handoff. Stroke uses currentColor so
// the parent's `color` drives them; sizing via the `size` prop.
import { tokens } from "../tokens";

type IconProps = { size?: number };

function svg(size: number, children: React.ReactNode) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {children}
    </svg>
  );
}

const S = { stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round", strokeLinejoin: "round" } as const;

export function Logo({ size = 24 }: IconProps) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: 7,
        background: tokens.color.dark,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flex: "0 0 auto",
      }}
    >
      <svg width={size * 0.58} height={size * 0.58} viewBox="0 0 24 24" fill="none">
        <circle cx="6" cy="6" r="2.6" fill={tokens.color.onDark} />
        <circle cx="18" cy="18" r="2.6" fill={tokens.color.violetDot} />
        <path d="M6.5 8.2C6.5 14 10 18 16 18" stroke={tokens.color.onDark} strokeWidth="1.6" strokeLinecap="round" opacity="0.85" />
      </svg>
    </div>
  );
}

export const IconChevronDown = ({ size = 14 }: IconProps) =>
  svg(size, <path d="M6 9l6 6 6-6" {...S} strokeWidth={2} />);
export const IconChevronRight = ({ size = 16 }: IconProps) =>
  svg(size, <path d="M9 6l6 6-6 6" {...S} strokeWidth={1.9} />);
export const IconChevronLeft = ({ size = 16 }: IconProps) =>
  svg(size, <path d="M15 6l-6 6 6 6" {...S} strokeWidth={1.9} />);
export const IconFit = ({ size = 17 }: IconProps) =>
  svg(size, <path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3" {...S} />);
export const IconFitCorners = ({ size = 15 }: IconProps) =>
  svg(size, <path d="M3 9V5a2 2 0 0 1 2-2h4M21 9V5a2 2 0 0 0-2-2h-4M3 15v4a2 2 0 0 0 2 2h4M21 15v4a2 2 0 0 1-2 2h-4" {...S} strokeWidth={1.8} />);
export const IconExport = ({ size = 17 }: IconProps) =>
  svg(size, <path d="M12 15V4m0 0L8 8m4-4l4 4M4 17v1a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3v-1" {...S} />);
export const IconSettings = ({ size = 17 }: IconProps) =>
  svg(
    size,
    <>
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.7" />
      <path d="M12 2.5v2M12 19.5v2M21.5 12h-2M4.5 12h-2M18.7 5.3l-1.4 1.4M6.7 17.3l-1.4 1.4M18.7 18.7l-1.4-1.4M6.7 6.7L5.3 5.3" {...S} />
    </>,
  );
export const IconSidebar = ({ size = 17 }: IconProps) =>
  svg(
    size,
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" stroke="currentColor" strokeWidth="1.7" />
      <path d="M9.5 4.5v15" stroke="currentColor" strokeWidth="1.7" />
      <path d="M15.5 9.5L13 12l2.5 2.5" {...S} />
    </>,
  );
export const IconMenu = ({ size = 18 }: IconProps) =>
  svg(size, <path d="M4 7h16M4 12h16M4 17h16" {...S} strokeWidth={1.8} />);
export const IconFile = ({ size = 16 }: IconProps) =>
  svg(
    size,
    <>
      <path d="M13 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9l-6-6z" {...S} />
      <path d="M13 3v6h6" {...S} />
    </>,
  );
export const IconPlus = ({ size = 15 }: IconProps) =>
  svg(size, <path d="M12 5v14M5 12h14" {...S} strokeWidth={2} />);
export const IconMinus = ({ size = 16 }: IconProps) =>
  svg(size, <path d="M5 12h14" {...S} strokeWidth={2} />);
export const IconClose = ({ size = 15 }: IconProps) =>
  svg(size, <path d="M6 6l12 12M18 6L6 18" {...S} strokeWidth={1.9} />);
export const IconEmptyCard = ({ size = 26 }: IconProps) =>
  svg(
    size,
    <>
      <rect x="3.5" y="4.5" width="17" height="11" rx="2.5" stroke="currentColor" strokeWidth="1.7" />
      <path d="M8 20h8M12 15.5V20" {...S} />
    </>,
  );
export const IconDrill = ({ size = 16 }: IconProps) =>
  svg(
    size,
    <>
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.7" />
      <path d="M12 8.5v7M8.5 12h7" {...S} />
    </>,
  );
// "Enter / open sub-flow" — an arrow going into a box. Clearer than a bare ⊕.
export const IconEnter = ({ size = 14 }: IconProps) =>
  svg(
    size,
    <>
      <path d="M13 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" {...S} />
      <path d="M3 12h10M9.5 8l3.5 4-3.5 4" {...S} />
    </>,
  );
export const IconSource = ({ size = 13 }: IconProps) =>
  svg(size, <path d="M8 6l-5 6 5 6M16 6l5 6-5 6" {...S} strokeWidth={1.8} />);

// Vertical kebab — opens a document's context menu.
export const IconDots = ({ size = 16 }: IconProps) =>
  svg(
    size,
    <>
      <circle cx="12" cy="5" r="1.6" fill="currentColor" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" />
      <circle cx="12" cy="19" r="1.6" fill="currentColor" />
    </>,
  );
export const IconLink = ({ size = 15 }: IconProps) =>
  svg(size, <path d="M10 13a3.5 3.5 0 0 0 5 0l3-3a3.5 3.5 0 0 0-5-5l-1.5 1.5M14 11a3.5 3.5 0 0 0-5 0l-3 3a3.5 3.5 0 0 0 5 5l1.5-1.5" {...S} />);
export const IconFolder = ({ size = 16 }: IconProps) =>
  svg(size, <path d="M3 7a2 2 0 0 1 2-2h3.6l2 2H19a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" {...S} />);
export const IconTrash = ({ size = 16 }: IconProps) =>
  svg(
    size,
    <>
      <path d="M4 7h16M10 11v6M14 11v6" {...S} />
      <path d="M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13M9 7V5a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 5v2" {...S} />
    </>,
  );
export const IconPencil = ({ size = 16 }: IconProps) =>
  svg(size, <path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4" {...S} />);
export const IconTag = ({ size = 16 }: IconProps) =>
  svg(
    size,
    <>
      <path d="M3 7.5a1.5 1.5 0 0 1 1.5-1.5H11l9 9-6.5 6.5-9-9V7.5z" {...S} />
      <circle cx="7.5" cy="10.5" r="1.1" fill="currentColor" />
    </>,
  );
// Document-kind glyphs (sidebar rows): Flow = two linked nodes, Sequence = lifelines + message.
export const IconFlowKind = ({ size = 16 }: IconProps) =>
  svg(
    size,
    <>
      <circle cx="6" cy="6.5" r="2.3" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="18" cy="17.5" r="2.3" stroke="currentColor" strokeWidth="1.6" />
      <path d="M7.7 8.2l8.6 7.6" {...S} strokeWidth={1.6} />
    </>,
  );
// Caller / callee relationship glyphs (sequence). Vertical arrows — up the call
// stack (caller) / down into callees — so they don't read as horizontal
// message/return arrows. Caller = ↑, callee = ↓.
export const IconCaller = ({ size = 14 }: IconProps) =>
  svg(size, <path d="M12 5v14M6 11l6-6 6 6" {...S} />);
export const IconCallee = ({ size = 14 }: IconProps) =>
  svg(size, <path d="M12 5v14M6 13l6 6 6-6" {...S} />);

// Resize affordances for the sequence size sliders.
export const IconWidthAdjust = ({ size = 16 }: IconProps) =>
  svg(size, <path d="M4 12h16M7 9l-3 3 3 3M17 9l3 3-3 3" {...S} strokeWidth={1.7} />);
export const IconHeightAdjust = ({ size = 16 }: IconProps) =>
  svg(size, <path d="M12 4v16M9 7l3-3 3 3M9 17l3 3 3-3" {...S} strokeWidth={1.7} />);
// Diagonal double-arrow (↖↘) — scales the whole layout's compactness (both axes),
// so it reads as neither width nor height.
export const IconDiagonalAdjust = ({ size = 16 }: IconProps) =>
  svg(size, <path d="M6 6l12 12M6 11V6h5M18 13v5h-5" {...S} strokeWidth={1.7} />);
// Revert / reset to default — a clean counter-clockwise circular arrow (same glyph
// for the Flow spacing slider and the Sequence size sliders).
export const IconReset = ({ size = 16 }: IconProps) =>
  svg(
    size,
    <>
      <polyline points="2.5 5 2.5 10.5 8 10.5" {...S} />
      <path d="M4.8 16.2a8 8 0 1 0 1.3-9.2L2.5 10.5" {...S} />
    </>,
  );
export const IconSeqKind = ({ size = 16 }: IconProps) =>
  svg(
    size,
    <>
      <path d="M7 4v16M17 4v16" {...S} strokeWidth={1.6} />
      <path d="M7 10.5h10M14 7.5l3 3-3 3" {...S} strokeWidth={1.6} />
    </>,
  );
