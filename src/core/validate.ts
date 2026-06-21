import { readFileSync } from "node:fs";
import Ajv2020, { type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import type { FlowDocument } from "./types";
import { detectSplits } from "./split";
import { pkgPath } from "./paths";

export interface Issue {
  code: string;
  severity: "error" | "warning";
  message: string;
  path?: string;
  suggestion?: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: Issue[];
  warnings: Issue[];
}

export interface ValidateOptions {
  /** Other workspace FLOWS, for cross-flow merge/split checks. */
  others?: FlowDocument[];
  /** All workspace document ids (flows AND sequences), for dangling drill-target
   *  resolution. Falls back to doc.id + others ids when omitted. */
  siblingIds?: string[];
}

const schema = JSON.parse(readFileSync(pkgPath("schema", "flow.schema.json"), "utf8"));

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validateSchema: ValidateFunction = ajv.compile(schema);

function schemaIssue(e: ErrorObject): Issue {
  const path = e.instancePath || "/";
  const extra =
    e.keyword === "additionalProperties" ? ` (${(e.params as { additionalProperty?: string }).additionalProperty})` : "";
  return { code: `schema/${e.keyword}`, severity: "error", message: `${path} ${e.message}${extra}` };
}

/**
 * Validate a Flow document: structure (JSON Schema) + semantics (referential
 * integrity, id uniqueness, shared-consistency/merge, split heuristic).
 * Hard problems → errors; advisory suspicions (splits, dangling subflow) → warnings.
 */
export function validateFlow(model: unknown, opts: ValidateOptions = {}): ValidationResult {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  const others = opts.others ?? [];

  // 1. Structure — JSON Schema.
  if (!validateSchema(model)) {
    for (const e of validateSchema.errors ?? []) errors.push(schemaIssue(e));
    return { ok: false, errors, warnings };
  }
  const doc = model as FlowDocument;

  // 2. Uniqueness.
  const nodeIds = new Set<string>();
  for (const n of doc.nodes) {
    if (nodeIds.has(n.id)) {
      errors.push({ code: "dup-node-id", severity: "error", message: `duplicate node id "${n.id}"`, path: `nodes` });
    }
    nodeIds.add(n.id);
  }
  const actorIds = new Set<string>();
  for (const a of doc.actors) {
    if (actorIds.has(a.id)) {
      errors.push({ code: "dup-actor-id", severity: "error", message: `duplicate actor id "${a.id}"`, path: `actors` });
    }
    actorIds.add(a.id);
  }
  // Edge ids (when present) share the object-id namespace with nodes — an edge is
  // a first-class object, so its id must not collide with any node or other edge.
  const objectIds = new Set<string>(nodeIds);
  for (const e of doc.edges) {
    if (!e.id) continue;
    if (objectIds.has(e.id)) {
      errors.push({ code: "dup-object-id", severity: "error", message: `edge id "${e.id}" collides with another node/edge id`, path: `edges` });
    }
    objectIds.add(e.id);
  }

  // 3. Referential integrity.
  for (const n of doc.nodes) {
    if (n.owner && !actorIds.has(n.owner)) {
      errors.push({
        code: "dangling-owner",
        severity: "error",
        message: `node "${n.id}" references undeclared owner "${n.owner}"`,
        suggestion: `add an actor with id "${n.owner}" to actors[], or fix the owner`,
      });
    }
  }
  for (const e of doc.edges) {
    if (!nodeIds.has(e.from)) {
      errors.push({ code: "dangling-edge", severity: "error", message: `edge from "${e.from}" → "${e.to}" has unknown source "${e.from}"` });
    }
    if (!nodeIds.has(e.to)) {
      errors.push({ code: "dangling-edge", severity: "error", message: `edge from "${e.from}" → "${e.to}" has unknown target "${e.to}"` });
    }
  }

  // 4. Subflow targets (advisory — the sub-flow may not be authored yet). Both
  // subflow nodes and edges (an edge can drill into a flow for the transition).
  const workspaceIds = new Set<string>(opts.siblingIds ?? [doc.id, ...others.map((d) => d.id)]);
  for (const n of doc.nodes) {
    if (n.type === "subflow" && n.subflow && !workspaceIds.has(n.subflow)) {
      warnings.push({
        code: "dangling-subflow",
        severity: "warning",
        message: `subflow node "${n.id}" drills into "${n.subflow}", which is not in the workspace yet`,
      });
    }
  }
  for (const e of doc.edges) {
    if (e.subflow && !workspaceIds.has(e.subflow)) {
      warnings.push({
        code: "dangling-subflow",
        severity: "warning",
        message: `edge "${e.from}" → "${e.to}" drills into "${e.subflow}", which is not in the workspace yet`,
      });
    }
  }
  // Sequence drill targets (node/edge → a *.sequence.json document).
  for (const n of doc.nodes) {
    if (n.sequence && !workspaceIds.has(n.sequence)) {
      warnings.push({
        code: "dangling-sequence",
        severity: "warning",
        message: `node "${n.id}" drills into sequence "${n.sequence}", which is not in the workspace yet`,
      });
    }
  }
  for (const e of doc.edges) {
    if (e.sequence && !workspaceIds.has(e.sequence)) {
      warnings.push({
        code: "dangling-sequence",
        severity: "warning",
        message: `edge "${e.from}" → "${e.to}" drills into sequence "${e.sequence}", which is not in the workspace yet`,
      });
    }
  }

  // 5. Merge — shared-id consistency across flows (deterministic; enforced).
  // Generalized over OBJECTS (nodes + edges): a shared id must denote the same
  // kind of thing everywhere. A shared id used as a node in one flow and an edge
  // in another — or as two edges of different type — is a conflict.
  type Occ = { flowId: string; kind: string; owner?: string };
  const sharedById = new Map<string, Occ[]>();
  const collectShared = (d: FlowDocument) => {
    for (const n of d.nodes) {
      if (n.shared) {
        const list = sharedById.get(n.id) ?? [];
        list.push({ flowId: d.id, kind: `node/${n.type}`, owner: n.owner });
        sharedById.set(n.id, list);
      }
    }
    for (const e of d.edges) {
      if (e.shared && e.id) {
        const list = sharedById.get(e.id) ?? [];
        list.push({ flowId: d.id, kind: `edge/${e.type}` });
        sharedById.set(e.id, list);
      }
    }
  };
  collectShared(doc);
  others.forEach(collectShared);
  for (const [id, occ] of sharedById) {
    const kinds = new Set(occ.map((o) => o.kind));
    const owners = new Set(occ.map((o) => o.owner ?? "-"));
    if (kinds.size > 1 || owners.size > 1) {
      const where = occ.map((o) => `${o.flowId}(${o.kind}/${o.owner ?? "-"})`).join(" vs ");
      errors.push({
        code: "shared-conflict",
        severity: "error",
        message: `shared id "${id}" is inconsistent across flows: ${where} — one id, conflicting nature`,
        suggestion: "make the shared object identical everywhere, or give the differing ones distinct ids",
      });
    }
  }

  // 6b. Convention (advisory): a readable flow has a Start terminal (entry, no
  // incoming) and a Done terminal (exit, no outgoing). Suggest, never block.
  const incoming = new Set(doc.edges.map((e) => e.to));
  const outgoing = new Set(doc.edges.map((e) => e.from));
  const hasStart = doc.nodes.some((n) => n.type === "terminal" && !incoming.has(n.id));
  const hasDone = doc.nodes.some((n) => n.type === "terminal" && !outgoing.has(n.id));
  if (!hasStart) {
    warnings.push({
      code: "no-start-terminal",
      severity: "warning",
      message: "flow has no Start terminal (a terminal node with no incoming edges)",
      suggestion: "add a terminal node marking the entry point",
    });
  }
  if (!hasDone) {
    warnings.push({
      code: "no-done-terminal",
      severity: "warning",
      message: "flow has no Done terminal (a terminal node with no outgoing edges)",
      suggestion: "add a terminal node marking the exit point",
    });
  }

  // 6c. Owner coverage (advisory): if actors are declared, non-terminal nodes
  // should carry an `owner` so the diagram is color-coded by who acts. Neutral
  // terminals (Start/Done) are conventionally fine. Nudges, never blocks.
  if (doc.actors.length >= 1) {
    const ownable = doc.nodes.filter((n) => n.type !== "terminal");
    const unowned = ownable.filter((n) => !n.owner);
    if (ownable.length > 0 && unowned.length > 0) {
      const ids = unowned.slice(0, 6).map((n) => `"${n.id}"`).join(", ");
      const more = unowned.length > 6 ? `, …(+${unowned.length - 6} more)` : "";
      const all = unowned.length === ownable.length;
      warnings.push({
        code: "nodes-without-owner",
        severity: "warning",
        message: all
          ? `${doc.actors.length} actor(s) declared but no node has an owner — the diagram cannot be color-coded by actor`
          : `${unowned.length} of ${ownable.length} nodes have no owner: ${ids}${more}`,
        suggestion: `set "owner" to an actor id (one of: ${doc.actors.map((a) => a.id).join(", ")}) so each node is colored by who performs it`,
      });
    }
  }

  // 6. Split — possible duplicates under different identity (heuristic; advisory).
  // NODE-only by design: the heuristic keys on owner + label + neighbor topology,
  // which edges lack (no owner; label is a branch condition). Cross-flow "same
  // edge" would be a different algorithm (identity by from/to/type) — not in scope.
  for (const s of detectSplits(doc, others)) {
    warnings.push({
      code: "possible-split",
      severity: "warning",
      message: s.message,
      suggestion: `score ${s.score}`,
    });
  }

  return { ok: errors.length === 0, errors, warnings };
}
