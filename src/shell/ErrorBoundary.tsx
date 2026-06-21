import { Component, type ReactNode } from "react";
import { tokens } from "../tokens";

// A render error in the canvas used to blank the WHOLE app (white screen). This
// contains it: the failing diagram shows a message; the rest of the UI (sidebar,
// other documents) keeps working. Key it by document id so switching docs resets it.
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error("flow-trace render error:", error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", padding: 32, textAlign: "center" }}>
        <div style={{ maxWidth: 460 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: tokens.color.text, marginBottom: 8 }}>Couldn't render this diagram</div>
          <div style={{ fontSize: 12.5, color: tokens.color.textSecondary, lineHeight: 1.5, marginBottom: 10 }}>
            The document loaded but the view hit an error. Other documents still work — pick another from the sidebar.
          </div>
          <pre style={{ fontSize: 11, fontFamily: tokens.font.mono, color: tokens.color.faint, background: tokens.color.field, border: `1px solid ${tokens.color.border}`, borderRadius: 8, padding: 10, overflowX: "auto", textAlign: "left", whiteSpace: "pre-wrap", margin: 0 }}>
            {String(this.state.error.message || this.state.error)}
          </pre>
        </div>
      </div>
    );
  }
}
