import { test } from "node:test";
import assert from "node:assert/strict";
import { validateSequence } from "./validate-sequence";
import type { SequenceDocument } from "./sequence-types";

function seq(over: Partial<SequenceDocument> = {}): SequenceDocument {
  return {
    version: "1",
    kind: "sequence",
    id: "s",
    title: "S",
    actors: [
      { id: "api", label: "API", kind: "service" },
      { id: "db", label: "DB", kind: "infra" },
    ],
    calls: [{ id: "c1", from: "api", to: "db", method: "insert" }],
    ...over,
  };
}

const codes = (r: { errors: { code: string }[]; warnings: { code: string }[] }) => ({
  errors: r.errors.map((e) => e.code),
  warnings: r.warnings.map((w) => w.code),
});

test("valid sequence passes", () => {
  const r = validateSequence(seq());
  assert.equal(r.ok, true);
  assert.equal(r.errors.length, 0);
});

test("nested calls are walked; valid nesting passes", () => {
  const r = validateSequence(
    seq({
      calls: [
        {
          id: "charge",
          from: "api",
          to: "db",
          method: "charge",
          children: [{ id: "auth", from: "db", to: "api", method: "auth" }],
        },
      ],
    }),
  );
  assert.equal(r.ok, true);
});

test("schema violation — missing 'to'", () => {
  const r = validateSequence(seq({ calls: [{ id: "c1", method: "x" } as never] }));
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.code.startsWith("schema/")));
});

test("schema violation — wrong kind", () => {
  const r = validateSequence(seq({ kind: "flow" as never }));
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.code.startsWith("schema/")));
});

test("dangling actor (to) is an error", () => {
  const r = validateSequence(seq({ calls: [{ id: "c1", from: "api", to: "ghost", method: "x" }] }));
  assert.equal(r.ok, false);
  assert.ok(codes(r).errors.includes("dangling-actor"));
});

test("duplicate call id (incl. nested) is an error", () => {
  const r = validateSequence(
    seq({
      calls: [
        { id: "dup", from: "api", to: "db", method: "a", children: [{ id: "dup", from: "db", to: "api", method: "b" }] },
      ],
    }),
  );
  assert.equal(r.ok, false);
  assert.ok(codes(r).errors.includes("dup-call-id"));
});

test("dangling phase reference is an error", () => {
  const r = validateSequence(seq({ calls: [{ id: "c1", from: "api", to: "db", method: "x", phase: "ghost" }] }));
  assert.equal(r.ok, false);
  assert.ok(codes(r).errors.includes("dangling-phase"));
});
