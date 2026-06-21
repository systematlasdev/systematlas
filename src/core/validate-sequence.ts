import { readFileSync } from "node:fs";
import Ajv2020, { type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import type { Issue, ValidationResult } from "./validate";
import type { SequenceCall, SequenceDocument } from "./sequence-types";
import { pkgPath } from "./paths";

const schema = JSON.parse(readFileSync(pkgPath("schema", "sequence.schema.json"), "utf8"));

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validateSchema: ValidateFunction = ajv.compile(schema);

function schemaIssue(e: ErrorObject): Issue {
  const path = e.instancePath || "/";
  const extra =
    e.keyword === "additionalProperties" ? ` (${(e.params as { additionalProperty?: string }).additionalProperty})` : "";
  return { code: `schema/${e.keyword}`, severity: "error", message: `${path} ${e.message}${extra}` };
}

/** Pre-order walk of the call tree (chronological order). */
function walk(calls: SequenceCall[], visit: (c: SequenceCall) => void): void {
  for (const c of calls) {
    visit(c);
    if (c.children?.length) walk(c.children, visit);
  }
}

/**
 * Validate a Sequence document: structure (JSON Schema) + semantics
 * (call-id uniqueness incl. nested, referential integrity of from/to → actors
 * and phase → declared phases). Hard problems → errors. No split/merge heuristic
 * (that is Flow-node-topology shaped; a different problem, out of scope here).
 */
export function validateSequence(model: unknown): ValidationResult {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];

  // 1. Structure — JSON Schema.
  if (!validateSchema(model)) {
    for (const e of validateSchema.errors ?? []) errors.push(schemaIssue(e));
    return { ok: false, errors, warnings };
  }
  const doc = model as SequenceDocument;

  // 2. Actor + phase id sets.
  const actorIds = new Set<string>();
  for (const a of doc.actors) {
    if (actorIds.has(a.id)) errors.push({ code: "dup-actor-id", severity: "error", message: `duplicate actor id "${a.id}"`, path: "actors" });
    actorIds.add(a.id);
  }
  const phaseIds = new Set<string>((doc.phases ?? []).map((p) => p.id));

  // 3. Call-id uniqueness (across ALL calls, including nested) + referential integrity.
  const callIds = new Set<string>();
  walk(doc.calls, (c) => {
    if (callIds.has(c.id)) {
      errors.push({ code: "dup-call-id", severity: "error", message: `duplicate call id "${c.id}"`, path: "calls" });
    }
    callIds.add(c.id);
    if (!actorIds.has(c.to)) {
      errors.push({
        code: "dangling-actor",
        severity: "error",
        message: `call "${c.id}" targets undeclared actor (to) "${c.to}"`,
        suggestion: `add an actor with id "${c.to}", or fix the callee`,
      });
    }
    if (c.from && !actorIds.has(c.from)) {
      errors.push({
        code: "dangling-actor",
        severity: "error",
        message: `call "${c.id}" references undeclared actor (from) "${c.from}"`,
        suggestion: `add an actor with id "${c.from}", or fix the caller`,
      });
    }
    if (c.phase && !phaseIds.has(c.phase)) {
      errors.push({
        code: "dangling-phase",
        severity: "error",
        message: `call "${c.id}" references undeclared phase "${c.phase}"`,
        suggestion: `add a phase with id "${c.phase}" to phases[], or remove it`,
      });
    }
  });

  return { ok: errors.length === 0, errors, warnings };
}
