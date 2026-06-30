// Pure Sequence-document types — the TypeScript mirror of schema/sequence.schema.json.
// Shared by the renderer, the MCP server, the CLI and tests. Browser/Node-safe.
// Reuses the same primitive shapes as the Flow model (Actor, IoField, SourceRef…).

import type { Actor, ExternalRef, IoField, SourceRef } from "./types";

export type { Actor, IoField, SourceRef, ExternalRef };

export interface SequencePhase {
  id: string;
  label: string;
}

/** One call/message. `to` + `method` required; the rest mirrors a Flow node's
 *  optional content. `children` are calls made during this call's activation. */
export interface SequenceCall {
  id: string;
  to: string;
  method: string;
  from?: string;
  phase?: string;
  description?: string[];
  params?: IoField[];
  returns?: IoField[];
  returnType?: string;
  request?: string;
  response?: string;
  source?: SourceRef;
  refs?: ExternalRef[];
  async?: boolean;
  children?: SequenceCall[];
}

export interface SequenceDocument {
  version: string;
  kind: "sequence";
  id: string;
  title: string;
  /** Optional document-level overview (paragraphs), shown in the bottom bar. */
  overview?: string[];
  /** Optional id of the TWIN document — the same whole scenario at the other
   *  altitude (Sequence ↔ Flow). Document-level link, distinct from drill-down. */
  twin?: string;
  actors: Actor[];
  phases?: SequencePhase[];
  calls: SequenceCall[];
}
