// Pure Flow-document types — the TypeScript mirror of schema/flow.schema.json.
// Shared by the browser renderer (src/model.ts), the MCP server, the CLI and
// tests. Must stay free of any browser/Node-specific imports.

export type ActorKind = "human" | "system" | "service" | "infra";

export interface Actor {
  id: string;
  label: string;
  kind: ActorKind;
  color?: string;
}

export type NodeType = "terminal" | "step" | "decision" | "subflow" | "io";

export interface IoField {
  name: string;
  type?: string;
}

export interface SourceRef {
  file?: string;
  symbol?: string;
  line?: number;
}

export interface ExternalRef {
  label: string;
  url: string;
}

export interface FlowNode {
  id: string;
  type: NodeType;
  label: string;
  /** What the step does, one thesis per item (rendered as bullets). Required, ≥1. */
  description: string[];
  owner?: string;
  shared?: boolean;
  subflow?: string;
  /** Drill-down into a Sequence document (low-level) describing this step. */
  sequence?: string;
  inputs?: IoField[];
  outputs?: IoField[];
  source?: SourceRef;
  refs?: ExternalRef[];
}

export type EdgeType = "flow" | "branch" | "return";

export interface FlowEdge {
  from: string;
  to: string;
  type: EdgeType;
  label?: string;
  // An edge is a first-class object like a node: optional id/content + drill-down.
  // Edge ids share the node id-namespace (unique across nodes+edges in a flow).
  id?: string;
  /** What happens during the transition, one thesis per item. Optional (unlike a node). */
  description?: string[];
  inputs?: IoField[];
  outputs?: IoField[];
  source?: SourceRef;
  refs?: ExternalRef[];
  /** Opt-in cross-flow identity (requires id), same semantics as node.shared. */
  shared?: boolean;
  /** Drill-down: id of a flow describing how the transition happens. */
  subflow?: string;
  /** Drill-down into a Sequence document (low-level) for this transition. */
  sequence?: string;
}

export type LayoutDir = "TB" | "LR";

export interface FlowDocument {
  version: string;
  id: string;
  title: string;
  layout?: LayoutDir;
  /** Optional document-level overview (paragraphs), shown in the bottom bar. */
  overview?: string[];
  actors: Actor[];
  nodes: FlowNode[];
  edges: FlowEdge[];
}
