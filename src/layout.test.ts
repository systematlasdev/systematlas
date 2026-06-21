import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildGraph } from "./layout";
import { buildActorColors } from "./theme";
import type { FlowDocument } from "./core/types";

// Regression guard: buildGraph runs dagre with NAMED edges (to read back routed
// waypoints), which requires a multigraph. typecheck/build don't execute it, so a
// throw here (e.g. "Cannot set a named edge when isMultigraph = false") shipped
// unnoticed once and blanked the renderer. Exercise it on the real examples.
const load = (name: string): FlowDocument => JSON.parse(readFileSync(new URL(`../examples/${name}`, import.meta.url), "utf8"));

for (const file of ["transaction-create.flow.json", "payment-charge.flow.json", "refund.flow.json"]) {
  test(`buildGraph lays out ${file} without throwing + routes every edge`, () => {
    const doc = load(file);
    const g = buildGraph(doc, buildActorColors(doc.actors), { flowsSet: new Set(), onDrill: () => {} });
    assert.equal(g.nodes.length, doc.nodes.length);
    assert.equal(g.edges.length, doc.edges.length);
    for (const e of g.edges) {
      const points = (e.data as { points?: { x: number; y: number }[] }).points;
      assert.ok(points && points.length >= 2, `edge ${e.id} should have routed waypoints`);
    }
  });
}
