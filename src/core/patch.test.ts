import { test } from "node:test";
import assert from "node:assert/strict";
import { applyPatch } from "./patch";
import type { FlowDocument } from "./types";
import type { SequenceDocument } from "./sequence-types";

const flow = (): FlowDocument => ({
  version: "1",
  id: "f",
  title: "F",
  actors: [],
  nodes: [{ id: "a", type: "step", label: "A", description: ["x"] }],
  edges: [],
});

test("set-field on a node (the common 'add one field' case)", () => {
  const out = applyPatch(flow(), [{ op: "set-field", target: "node", id: "a", field: "label", value: "A2" }]) as FlowDocument;
  assert.equal(out.nodes[0].label, "A2");
});

test("set-field on the doc", () => {
  const out = applyPatch(flow(), [{ op: "set-field", target: "doc", field: "title", value: "New" }]) as FlowDocument;
  assert.equal(out.title, "New");
});

test("upsert-node adds then replaces by id; remove-node removes", () => {
  let out = applyPatch(flow(), [{ op: "upsert-node", node: { id: "b", type: "terminal", label: "B", description: ["b"] } }]) as FlowDocument;
  assert.equal(out.nodes.length, 2);
  out = applyPatch(out, [{ op: "upsert-node", node: { id: "b", type: "terminal", label: "B2", description: ["b"] } }]) as FlowDocument;
  assert.equal(out.nodes.length, 2);
  assert.equal(out.nodes.find((n) => n.id === "b")?.label, "B2");
  out = applyPatch(out, [{ op: "remove-node", id: "b" }]) as FlowDocument;
  assert.equal(out.nodes.length, 1);
});

test("upsert-edge / remove-edge by id", () => {
  let out = applyPatch(flow(), [{ op: "upsert-edge", edge: { id: "e1", from: "a", to: "a", type: "flow" } }]) as FlowDocument;
  assert.equal(out.edges.length, 1);
  out = applyPatch(out, [{ op: "remove-edge", id: "e1" }]) as FlowDocument;
  assert.equal(out.edges.length, 0);
});

test("set-field unknown node throws (caught by the tool → reported)", () => {
  assert.throws(() => applyPatch(flow(), [{ op: "set-field", target: "node", id: "nope", field: "label", value: "x" }]));
});

test("does not mutate the input document", () => {
  const original = flow();
  applyPatch(original, [{ op: "set-field", target: "node", id: "a", field: "label", value: "Z" }]);
  assert.equal(original.nodes[0].label, "A");
});

const seq = (): SequenceDocument => ({
  version: "1",
  kind: "sequence",
  id: "s",
  title: "S",
  actors: [{ id: "api", label: "API", kind: "service" }],
  calls: [{ id: "c", to: "api", method: "m", children: [] }],
});

test("upsert-call nests under a parent; remove-call finds it in the tree", () => {
  let out = applyPatch(seq(), [{ op: "upsert-call", call: { id: "c2", to: "api", method: "m2" }, parent: "c" }]) as SequenceDocument;
  assert.equal(out.calls[0].children?.length, 1);
  assert.equal(out.calls[0].children?.[0].id, "c2");
  out = applyPatch(out, [{ op: "remove-call", id: "c2" }]) as SequenceDocument;
  assert.equal(out.calls[0].children?.length, 0);
});
