import { test } from "node:test";
import assert from "node:assert/strict";
import { validateFlow } from "./validate";
import type { FlowDocument } from "./types";

function doc(over: Partial<FlowDocument> = {}): FlowDocument {
  return {
    version: "1",
    id: "t",
    title: "T",
    actors: [{ id: "api", label: "API", kind: "service" }],
    nodes: [{ id: "a", type: "step", label: "A", description: ["does A"], owner: "api" }],
    edges: [],
    ...over,
  };
}

const codes = (r: { errors: { code: string }[]; warnings: { code: string }[] }) => ({
  errors: r.errors.map((e) => e.code),
  warnings: r.warnings.map((w) => w.code),
});

test("valid document passes with no issues", () => {
  // A complete flow: Start terminal → step → Done terminal.
  const r = validateFlow(
    doc({
      nodes: [
        { id: "start", type: "terminal", label: "Start", description: ["entry"] },
        { id: "a", type: "step", label: "A", description: ["does A"], owner: "api" },
        { id: "done", type: "terminal", label: "Done", description: ["exit"] },
      ],
      edges: [
        { from: "start", to: "a", type: "flow" },
        { from: "a", to: "done", type: "flow" },
      ],
    }),
  );
  assert.equal(r.ok, true);
  assert.equal(r.errors.length, 0);
  assert.equal(r.warnings.length, 0);
});

test("node.sequence to a missing document is advised (dangling-sequence)", () => {
  const r = validateFlow(
    doc({
      nodes: [{ id: "a", type: "step", label: "A", description: ["x"], owner: "api", sequence: "no-such-seq" }],
    }),
  );
  assert.equal(r.ok, true); // advisory
  assert.ok(codes(r).warnings.includes("dangling-sequence"));
});

test("flow without Start/Done terminals is advised (warning, not error)", () => {
  const r = validateFlow(doc()); // single step, no terminals
  assert.equal(r.ok, true);
  assert.ok(codes(r).warnings.includes("no-start-terminal"));
  assert.ok(codes(r).warnings.includes("no-done-terminal"));
});

test("actors declared but nodes have no owner is advised (nodes-without-owner)", () => {
  // Two actors, but the only ownable node lacks an owner → advisory nudge.
  const r = validateFlow(
    doc({
      actors: [
        { id: "api", label: "API", kind: "service" },
        { id: "db", label: "DB", kind: "infra" },
      ],
      nodes: [
        { id: "start", type: "terminal", label: "Start", description: ["entry"] },
        { id: "a", type: "step", label: "A", description: ["does A"] }, // no owner
        { id: "done", type: "terminal", label: "Done", description: ["exit"] },
      ],
      edges: [
        { from: "start", to: "a", type: "flow" },
        { from: "a", to: "done", type: "flow" },
      ],
    }),
  );
  assert.equal(r.ok, true); // advisory, not blocking
  assert.ok(codes(r).warnings.includes("nodes-without-owner"));
});

test("terminals without owner do NOT trigger nodes-without-owner", () => {
  // Every non-terminal node is owned; neutral Start/Done terminals are fine.
  const r = validateFlow(
    doc({
      nodes: [
        { id: "start", type: "terminal", label: "Start", description: ["entry"] },
        { id: "a", type: "step", label: "A", description: ["does A"], owner: "api" },
        { id: "done", type: "terminal", label: "Done", description: ["exit"] },
      ],
      edges: [
        { from: "start", to: "a", type: "flow" },
        { from: "a", to: "done", type: "flow" },
      ],
    }),
  );
  assert.ok(!codes(r).warnings.includes("nodes-without-owner"));
});

test("schema violation — unknown node type", () => {
  const bad = doc({ nodes: [{ id: "a", type: "frobnicate" as never, label: "A", description: ["x"] }] });
  const r = validateFlow(bad);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.code.startsWith("schema/")));
});

test("schema violation — missing description", () => {
  const bad = doc({ nodes: [{ id: "a", type: "step", label: "A", owner: "api" } as never] });
  const r = validateFlow(bad);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.code.startsWith("schema/")));
});

test("dangling owner reference", () => {
  const r = validateFlow(doc({ nodes: [{ id: "a", type: "step", label: "A", description: ["x"], owner: "ghost" }] }));
  assert.equal(r.ok, false);
  assert.ok(codes(r).errors.includes("dangling-owner"));
});

test("dangling edge endpoint", () => {
  const r = validateFlow(doc({ edges: [{ from: "a", to: "missing", type: "flow" }] }));
  assert.equal(r.ok, false);
  assert.ok(codes(r).errors.includes("dangling-edge"));
});

test("duplicate node id", () => {
  const r = validateFlow(
    doc({
      nodes: [
        { id: "a", type: "step", label: "A", description: ["x"], owner: "api" },
        { id: "a", type: "step", label: "A2", description: ["y"], owner: "api" },
      ],
    }),
  );
  assert.equal(r.ok, false);
  assert.ok(codes(r).errors.includes("dup-node-id"));
});

test("merge — shared id with conflicting owner across flows", () => {
  const target = doc({
    id: "txn",
    actors: [{ id: "payment", label: "Payment", kind: "system" }],
    nodes: [{ id: "charge", type: "step", label: "Charge", description: ["charges"], owner: "payment", shared: true }],
  });
  const other = doc({
    id: "shipping",
    actors: [{ id: "db", label: "DB", kind: "infra" }],
    nodes: [{ id: "charge", type: "step", label: "Charge", description: ["charges"], owner: "db", shared: true }],
  });
  const r = validateFlow(target, { others: [other] });
  assert.equal(r.ok, false);
  assert.ok(codes(r).errors.includes("shared-conflict"));
});

test("split — same label+owner under different ids across flows is flagged", () => {
  const target = doc({
    id: "txn",
    nodes: [{ id: "txn.validate", type: "step", label: "Validate request", description: ["validates"], owner: "api" }],
  });
  const other = doc({
    id: "refund",
    nodes: [{ id: "rfnd.validate", type: "step", label: "Validate request", description: ["validates"], owner: "api" }],
  });
  const r = validateFlow(target, { others: [other] });
  assert.equal(r.ok, true); // advisory only — does not block
  assert.ok(codes(r).warnings.includes("possible-split"));
});

test("unrelated nodes are NOT flagged as splits (high precision)", () => {
  const target = doc({
    id: "txn",
    actors: [
      { id: "api", label: "API", kind: "service" },
      { id: "db", label: "DB", kind: "infra" },
    ],
    nodes: [{ id: "txn.insert", type: "step", label: "Insert transaction", description: ["persists"], owner: "db" }],
  });
  const other = doc({
    id: "refund",
    nodes: [{ id: "rfnd.validate", type: "step", label: "Validate request", description: ["validates"], owner: "api" }],
  });
  const r = validateFlow(target, { others: [other] });
  assert.ok(!codes(r).warnings.includes("possible-split"));
});

test("edge with content is valid; edge.subflow dangling is advisory", () => {
  const r = validateFlow(
    doc({
      nodes: [
        { id: "a", type: "step", label: "A", description: ["does A"], owner: "api" },
        { id: "b", type: "step", label: "B", description: ["does B"], owner: "api" },
      ],
      edges: [
        { id: "a-b", from: "a", to: "b", type: "flow", description: ["a → b"], inputs: [{ name: "x" }], subflow: "no-such-flow" },
      ],
    }),
  );
  assert.equal(r.ok, true); // valid + advisory
  assert.ok(codes(r).warnings.includes("dangling-subflow"));
});

test("edge id colliding with a node id is an error (shared object namespace)", () => {
  const r = validateFlow(
    doc({
      nodes: [
        { id: "a", type: "step", label: "A", description: ["x"], owner: "api" },
        { id: "b", type: "step", label: "B", description: ["y"], owner: "api" },
      ],
      edges: [{ id: "a", from: "a", to: "b", type: "flow" }],
    }),
  );
  assert.equal(r.ok, false);
  assert.ok(codes(r).errors.includes("dup-object-id"));
});

test("shared edge inconsistent across flows is a merge conflict", () => {
  const target = doc({
    id: "txn",
    nodes: [
      { id: "a", type: "step", label: "A", description: ["x"], owner: "api" },
      { id: "b", type: "step", label: "B", description: ["y"], owner: "api" },
    ],
    edges: [{ id: "go", from: "a", to: "b", type: "flow", shared: true }],
  });
  const other = doc({
    id: "txn2",
    nodes: [
      { id: "a", type: "step", label: "A", description: ["x"], owner: "api" },
      { id: "b", type: "step", label: "B", description: ["y"], owner: "api" },
    ],
    edges: [{ id: "go", from: "a", to: "b", type: "branch", label: "yes", shared: true }],
  });
  const r = validateFlow(target, { others: [other] });
  assert.equal(r.ok, false);
  assert.ok(codes(r).errors.includes("shared-conflict"));
});
