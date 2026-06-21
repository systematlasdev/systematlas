import type { AnyDoc } from "./validate-doc";
import { docKind } from "./validate-doc";
import type { FlowDocument } from "./types";
import type { SequenceCall, SequenceDocument } from "./sequence-types";

// Partial edits to a document, applied by object id (not array index — arrays are
// keyed by id, indices are fragile). The MCP `patch_flow` tool reads the current
// doc, applies ops here, then validates + writes the WHOLE result — so partial
// edits stay cheap (only the delta is sent) without skipping validation.

export type PatchOp =
  | { op: "set-field"; target: "doc" | "node" | "edge" | "call"; id?: string; field: string; value: unknown }
  | { op: "upsert-node"; node: Record<string, unknown> }
  | { op: "remove-node"; id: string }
  | { op: "upsert-edge"; edge: Record<string, unknown> }
  | { op: "remove-edge"; id: string }
  | { op: "upsert-call"; call: Record<string, unknown>; parent?: string }
  | { op: "remove-call"; id: string };

type AnyObj = Record<string, unknown>;

function findCall(calls: SequenceCall[], id: string): SequenceCall | null {
  for (const c of calls) {
    if (c.id === id) return c;
    if (c.children?.length) {
      const hit = findCall(c.children, id);
      if (hit) return hit;
    }
  }
  return null;
}
function removeCall(calls: SequenceCall[], id: string): boolean {
  const i = calls.findIndex((c) => c.id === id);
  if (i >= 0) {
    calls.splice(i, 1);
    return true;
  }
  for (const c of calls) if (c.children?.length && removeCall(c.children, id)) return true;
  return false;
}

/** Apply ops to a deep copy of `doc` and return the new doc (caller validates). */
export function applyPatch(doc: AnyDoc, ops: PatchOp[]): AnyDoc {
  const d = structuredClone(doc) as AnyDoc;
  const kind = docKind(d);
  const flow = () => d as unknown as FlowDocument;
  const seq = () => d as unknown as SequenceDocument;

  for (const op of ops) {
    switch (op.op) {
      case "set-field": {
        if (op.target === "doc") {
          (d as unknown as AnyObj)[op.field] = op.value;
        } else if (op.target === "node") {
          const n = flow().nodes.find((x) => x.id === op.id);
          if (!n) throw new Error(`set-field: node "${op.id}" not found`);
          (n as unknown as AnyObj)[op.field] = op.value;
        } else if (op.target === "edge") {
          const e = flow().edges.find((x) => x.id === op.id);
          if (!e) throw new Error(`set-field: edge "${op.id}" not found (edges need an id to patch)`);
          (e as unknown as AnyObj)[op.field] = op.value;
        } else {
          const c = findCall(seq().calls, op.id ?? "");
          if (!c) throw new Error(`set-field: call "${op.id}" not found`);
          (c as unknown as AnyObj)[op.field] = op.value;
        }
        break;
      }
      case "upsert-node": {
        const nodes = flow().nodes as unknown as AnyObj[];
        const id = op.node.id;
        const i = nodes.findIndex((n) => n.id === id);
        if (i >= 0) nodes[i] = op.node;
        else nodes.push(op.node);
        break;
      }
      case "remove-node": {
        const f = flow();
        f.nodes = f.nodes.filter((n) => n.id !== op.id);
        break;
      }
      case "upsert-edge": {
        const edges = flow().edges as unknown as AnyObj[];
        const id = op.edge.id;
        const i = id != null ? edges.findIndex((e) => e.id === id) : -1;
        if (i >= 0) edges[i] = op.edge;
        else edges.push(op.edge);
        break;
      }
      case "remove-edge": {
        const f = flow();
        f.edges = f.edges.filter((e) => e.id !== op.id);
        break;
      }
      case "upsert-call": {
        const s = seq();
        const existing = findCall(s.calls, String(op.call.id));
        if (existing) {
          Object.assign(existing, op.call);
        } else if (op.parent) {
          const parent = findCall(s.calls, op.parent);
          if (!parent) throw new Error(`upsert-call: parent "${op.parent}" not found`);
          (parent.children ??= []).push(op.call as unknown as SequenceCall);
        } else {
          s.calls.push(op.call as unknown as SequenceCall);
        }
        break;
      }
      case "remove-call": {
        removeCall(seq().calls, op.id);
        break;
      }
      default: {
        throw new Error(`unknown op "${(op as { op: string }).op}"`);
      }
    }
    void kind;
  }
  return d;
}
