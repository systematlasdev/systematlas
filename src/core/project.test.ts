import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Project } from "./project";
import type { FlowDocument } from "./types";
import type { SequenceDocument } from "./sequence-types";

const tmp = () => fs.mkdtemp(path.join(os.tmpdir(), "ft-proj-"));
const flow = (id: string): FlowDocument => ({
  version: "1",
  id,
  title: `T ${id}`,
  actors: [],
  nodes: [{ id: "a", type: "step", label: "A", description: ["x"] }],
  edges: [],
});
const seq = (id: string): SequenceDocument => ({
  version: "1",
  kind: "sequence",
  id,
  title: `S ${id}`,
  actors: [{ id: "api", label: "API", kind: "service" }],
  calls: [{ id: "c", to: "api", method: "m" }],
});
const write = (dir: string, rel: string, obj: unknown) =>
  fs.mkdir(path.dirname(path.join(dir, rel)), { recursive: true }).then(() =>
    fs.writeFile(path.join(dir, rel), JSON.stringify(obj)),
  );

test("scan fallback (no manifest) lists both kinds, ungrouped", async () => {
  const dir = await tmp();
  await write(dir, "f1.flow.json", flow("f1"));
  await write(dir, "s1.sequence.json", seq("s1"));
  const es = await new Project(dir).entries();
  assert.deepEqual(
    es.map((e) => `${e.id}:${e.kind}:${e.category}`).sort(),
    ["f1:flow:", "s1:sequence:"],
  );
});

test("manifest: nested category + arbitrary path resolution", async () => {
  const dir = await tmp();
  await write(dir, "flows/x.flow.json", flow("txn"));
  await write(dir, ".flowtrace/project.json", {
    version: "1",
    name: "P",
    documents: [{ id: "txn", path: "flows/x.flow.json", category: "A/B" }],
  });
  const p = new Project(dir);
  const es = await p.entries();
  assert.equal(es.length, 1);
  assert.equal(es[0].id, "txn");
  assert.equal(es[0].category, "A/B");
  assert.equal((await p.read("txn")).id, "txn");
});

test("setCategory seeds a manifest from a scan", async () => {
  const dir = await tmp();
  await write(dir, "f1.flow.json", flow("f1"));
  const p = new Project(dir);
  await p.setCategory("f1", "Group/Sub");
  const m = await p.loadManifest();
  assert.ok(m);
  assert.equal(m!.documents.find((d) => d.id === "f1")?.category, "Group/Sub");
});

test("write with category creates manifest + file", async () => {
  const dir = await tmp();
  const p = new Project(dir);
  await p.write(flow("new1"), { category: "Cat" });
  const m = await p.loadManifest();
  assert.ok(m);
  assert.equal(m!.documents.find((d) => d.id === "new1")?.category, "Cat");
  assert.equal((await p.read("new1")).title, "T new1");
});

test("renameCategory rewrites the category and everything nested under it", async () => {
  const dir = await tmp();
  const p = new Project(dir);
  await p.write(flow("a"), { category: "Payments" });
  await p.write(flow("b"), { category: "Payments/Internals" });
  await p.write(flow("c"), { category: "Payments/Internals/Deep" });
  await p.write(flow("d"), { category: "Other" });
  await p.renameCategory("Payments", "Billing");
  const cat = (id: string) =>
    p.loadManifest().then((m) => m!.documents.find((e) => e.id === id)?.category);
  assert.equal(await cat("a"), "Billing");
  assert.equal(await cat("b"), "Billing/Internals");
  assert.equal(await cat("c"), "Billing/Internals/Deep");
  assert.equal(await cat("d"), "Other");
});

test("renameCategory to empty string ungroups the subtree", async () => {
  const dir = await tmp();
  const p = new Project(dir);
  await p.write(flow("a"), { category: "Tmp" });
  await p.write(flow("b"), { category: "Tmp/Sub" });
  await p.renameCategory("Tmp", "");
  const m = await p.loadManifest();
  assert.equal(m!.documents.find((e) => e.id === "a")?.category, "");
  assert.equal(m!.documents.find((e) => e.id === "b")?.category, "Sub");
});

test("rename changes title; remove deletes file + manifest entry", async () => {
  const dir = await tmp();
  const p = new Project(dir);
  await p.write(flow("r1"), { category: "C" });
  await p.rename("r1", "Renamed");
  assert.equal((await p.read("r1")).title, "Renamed");
  await p.remove("r1");
  assert.equal((await p.entries()).length, 0);
});
