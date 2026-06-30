import { test } from "node:test";
import assert from "node:assert/strict";
import { validateDoc, type AnyDoc } from "./validate-doc";
import type { FlowDocument } from "./types";
import type { SequenceDocument } from "./sequence-types";

// Minimal, fully-valid docs so only TWIN issues surface.
function flow(over: Partial<FlowDocument> = {}): FlowDocument {
  return {
    version: "1",
    id: "f",
    title: "F",
    actors: [{ id: "api", label: "API", kind: "service" }],
    nodes: [
      { id: "start", type: "terminal", label: "Start", description: ["entry"] },
      { id: "a", type: "step", label: "A", description: ["does A"], owner: "api" },
      { id: "done", type: "terminal", label: "Done", description: ["exit"] },
    ],
    edges: [
      { from: "start", to: "a", type: "flow" },
      { from: "a", to: "done", type: "flow" },
    ],
    ...over,
  };
}
function seq(over: Partial<SequenceDocument> = {}): SequenceDocument {
  return {
    version: "1",
    kind: "sequence",
    id: "s",
    title: "S",
    actors: [{ id: "api", label: "API", kind: "service" }],
    calls: [{ id: "c1", to: "api", method: "m" }],
    ...over,
  };
}
const hasCode = (r: { errors: { code: string }[]; warnings: { code: string }[] }, code: string) =>
  r.errors.some((e) => e.code === code) || r.warnings.some((w) => w.code === code);

test("mutual flow↔sequence twin → no twin issues", () => {
  const f = flow({ twin: "s" });
  const s = seq({ twin: "f" });
  const r = validateDoc(f, [f, s] as AnyDoc[]);
  assert.equal(r.ok, true);
  assert.equal(hasCode(r, "dangling-twin"), false);
  assert.equal(hasCode(r, "conflicting-twin"), false);
  assert.equal(hasCode(r, "same-kind-twin"), false);
});

test("one-sided twin (only one declares) is tolerated", () => {
  const f = flow({ twin: "s" });
  const s = seq(); // no twin back
  const r = validateDoc(f, [f, s] as AnyDoc[]);
  assert.equal(hasCode(r, "conflicting-twin"), false);
  assert.equal(hasCode(r, "dangling-twin"), false);
});

test("twin pointing at a missing doc → dangling-twin warning", () => {
  const f = flow({ twin: "nope" });
  const r = validateDoc(f, [f] as AnyDoc[]);
  assert.equal(r.ok, true); // advisory only
  assert.equal(hasCode(r, "dangling-twin"), true);
});

test("self-twin → error", () => {
  const f = flow({ twin: "f" });
  const r = validateDoc(f, [f] as AnyDoc[]);
  assert.equal(r.ok, false);
  assert.equal(hasCode(r, "self-twin"), true);
});

test("conflicting twin (does not point back) → warning", () => {
  const f = flow({ twin: "s" });
  const s = seq({ twin: "other" });
  const r = validateDoc(f, [f, s] as AnyDoc[]);
  assert.equal(hasCode(r, "conflicting-twin"), true);
});

test("same-kind twin (flow↔flow) → advisory warning", () => {
  const f = flow({ id: "f", twin: "f2" });
  const f2 = flow({ id: "f2", twin: "f" });
  const r = validateDoc(f, [f, f2] as AnyDoc[]);
  assert.equal(hasCode(r, "same-kind-twin"), true);
});
