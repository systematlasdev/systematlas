// Design tokens extracted from the Claude Design handoff
// (claude_designs/Flow-trace Shell.dc.html). The sustainable design-system
// source for the app shell — the live diagram canvas uses src/theme.ts for
// owner colors, which are calibrated to the same light palette.

export const tokens = {
  font: {
    ui: "'Hanken Grotesk', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
    mono: "'JetBrains Mono', ui-monospace, 'SFMono-Regular', Menlo, monospace",
  },
  color: {
    canvas: "#F6F2E9",
    topbar: "#FCFAF4",
    sidebar: "#FBF7EE",
    panel: "#FFFFFF",
    field: "#FAF7EF",
    border: "#EAE3D5",
    borderSoft: "#F0EADD",
    text: "#2A2722",
    textSecondary: "#6B655B",
    muted: "#8C8578",
    muted2: "#9A9384",
    faint: "#B0A892",
    faint2: "#C0B89F",
    dark: "#2D2A24",
    darkHover: "#423D34",
    onDark: "#F6F2E9",
    gridLine: "rgba(74,66,48,0.045)",
    // accents
    violet: "#5E54A8",
    violetDot: "#8B7FD4",
    violetBg: "#EDEAF8",
  },
  grid: 28,
  size: {
    topbar: 52,
    sidebar: 260,
    sidebarRail: 56,
    panel: 320,
    panelRail: 44,
  },
} as const;

// Display label per node type (UI text only).
export const TYPE_LABEL: Record<string, string> = {
  terminal: "terminal",
  step: "step",
  decision: "decision",
  subflow: "sub-flow",
  io: "i/o",
};

// Display label per edge type (UI text only).
export const EDGE_TYPE_LABEL: Record<string, string> = {
  flow: "flow",
  branch: "branch",
  return: "return / loop",
};
