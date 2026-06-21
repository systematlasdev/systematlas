// Kind-aware validation dispatch, shared by Workspace and Project.
import type { FlowDocument } from "./types";
import type { SequenceDocument } from "./sequence-types";
import { validateFlow, type ValidationResult } from "./validate";
import { validateSequence } from "./validate-sequence";

export type AnyDoc = FlowDocument | SequenceDocument;
export type DocKind = "flow" | "sequence";

export function docKind(d: AnyDoc): DocKind {
  return (d as SequenceDocument).kind === "sequence" ? "sequence" : "flow";
}

/**
 * Validate a document against the set of all workspace/project documents.
 * Sequences validate standalone; flows get cross-flow merge/split (flow others)
 * + dangling drill-target resolution over ALL document ids (flows + sequences).
 */
export function validateDoc(doc: AnyDoc, allDocs: AnyDoc[]): ValidationResult {
  if (docKind(doc) === "sequence") return validateSequence(doc as SequenceDocument);
  const flowOthers = allDocs.filter((d) => docKind(d) === "flow" && d.id !== doc.id) as FlowDocument[];
  const siblingIds = Array.from(new Set([doc.id, ...allDocs.map((d) => d.id)]));
  return validateFlow(doc as FlowDocument, { others: flowOthers, siblingIds });
}
