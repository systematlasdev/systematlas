// Browser-facing model module: re-exports the shared Flow types and loads the
// bundled example. The pure types live in src/core/types.ts (Node-safe).
import raw from "../examples/transaction-create.flow.json";

export type {
  Actor,
  ActorKind,
  NodeType,
  FlowNode,
  IoField,
  SourceRef,
  ExternalRef,
  EdgeType,
  FlowEdge,
  LayoutDir,
  FlowDocument,
} from "./core/types";
import type { FlowDocument } from "./core/types";
import type { SequenceDocument } from "./core/sequence-types";

export type { SequenceDocument, SequenceCall, SequencePhase } from "./core/sequence-types";

// A workspace document is either a Flow or a Sequence, discriminated by `kind`
// ("sequence" explicit; flows omit it / use "flow").
export type Doc = FlowDocument | SequenceDocument;
export type DocKind = "flow" | "sequence";
export function docKind(d: Doc): DocKind {
  return (d as SequenceDocument).kind === "sequence" ? "sequence" : "flow";
}

// Data attached to each React Flow node (consumed by the custom node components).
export interface NodeData {
  label: string;
  color: string;
  summary?: string; // first description point, shown on the node card
  owner?: string;
  shared?: boolean;
  /** Decision nodes only: bounding size (px) computed from the label so a long
   *  label still fits the diamond's inscribed area (src/layout.ts decisionSize). */
  decisionSize?: number;
  // Drill-down: resolved target (sub-flow for type:subflow, or a sequence for any
  // node with `sequence`), its kind, whether it resolves, + the "Open" handler.
  drillTarget?: string;
  drillKind?: "flow" | "sequence";
  canDrill?: boolean;
  onDrill?: DrillHandler;
  [key: string]: unknown;
}

/** Drill into `target`, optionally told which object (node/edge) triggered it,
 *  so the view can zoom toward that object's center before swapping flows. */
export type DrillOrigin = { kind: "node" | "edge"; id: string };
export type DrillHandler = (target: string, origin?: DrillOrigin) => void;

export const exampleFlow = raw as unknown as FlowDocument;
