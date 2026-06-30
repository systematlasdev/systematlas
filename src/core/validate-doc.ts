// Kind-aware validation dispatch, shared by Workspace and Project.
import type { FlowDocument } from "./types";
import type { SequenceDocument } from "./sequence-types";
import { validateFlow, type Issue, type ValidationResult } from "./validate";
import { validateSequence } from "./validate-sequence";

export type AnyDoc = FlowDocument | SequenceDocument;
export type DocKind = "flow" | "sequence";

export function docKind(d: AnyDoc): DocKind {
  return (d as SequenceDocument).kind === "sequence" ? "sequence" : "flow";
}

/**
 * Twin link checks (document-level "same scenario, other altitude" — distinct from
 * node/edge drill-down). Kind-agnostic, so it runs here over ALL documents rather
 * than inside the per-kind validators (which only see flows / nothing else).
 */
function validateTwin(doc: AnyDoc, allDocs: AnyDoc[]): { errors: Issue[]; warnings: Issue[] } {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  const twin = doc.twin;
  if (!twin) return { errors, warnings };
  if (twin === doc.id) {
    errors.push({ code: "self-twin", severity: "error", message: `document "${doc.id}" lists itself as its twin` });
    return { errors, warnings };
  }
  const found = allDocs.find((d) => d.id === twin && d.id !== doc.id);
  if (!found) {
    warnings.push({
      code: "dangling-twin",
      severity: "warning",
      message: `twin "${twin}" is not in the workspace yet`,
      suggestion: `author "${twin}" (the other altitude of this scenario), or fix the twin id`,
    });
    return { errors, warnings };
  }
  // The twin should point back here (when it declares a twin at all).
  if (found.twin && found.twin !== doc.id) {
    warnings.push({
      code: "conflicting-twin",
      severity: "warning",
      message: `twin "${twin}" points to "${found.twin}", not back to "${doc.id}"`,
      suggestion: `set the twin of "${twin}" to "${doc.id}" so the pairing is mutual`,
    });
  }
  // Advisory: twins usually pair a Flow with a Sequence, so the toggle switches altitude.
  if (docKind(found) === docKind(doc)) {
    warnings.push({
      code: "same-kind-twin",
      severity: "warning",
      message: `twin "${twin}" is also a ${docKind(doc)} — twins usually pair a Flow with a Sequence (two altitudes of one scenario)`,
    });
  }
  return { errors, warnings };
}

/**
 * Validate a document against the set of all workspace/project documents.
 * Sequences validate standalone; flows get cross-flow merge/split (flow others)
 * + dangling drill-target resolution over ALL document ids (flows + sequences).
 * Twin links are checked here (over all documents) on top of the per-kind result.
 */
export function validateDoc(doc: AnyDoc, allDocs: AnyDoc[]): ValidationResult {
  const base =
    docKind(doc) === "sequence"
      ? validateSequence(doc as SequenceDocument)
      : validateFlow(doc as FlowDocument, {
          others: allDocs.filter((d) => docKind(d) === "flow" && d.id !== doc.id) as FlowDocument[],
          siblingIds: Array.from(new Set([doc.id, ...allDocs.map((d) => d.id)])),
        });
  // If the document failed structural (schema) validation, its shape is unknown —
  // don't pile semantic twin warnings on top; fix the structure first.
  if (base.errors.some((e) => e.code.startsWith("schema/"))) return base;
  const twin = validateTwin(doc, allDocs);
  if (!twin.errors.length && !twin.warnings.length) return base;
  const errors = [...base.errors, ...twin.errors];
  return { ok: errors.length === 0, errors, warnings: [...base.warnings, ...twin.warnings] };
}
