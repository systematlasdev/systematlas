#!/usr/bin/env node
// flow-trace MCP server (stdio). A miniature surface over the JSON workspace:
// list_flows / read_flow / write_flow / validate_flow (docs/mcp-notes.md, Q4).
// The model is one JSON document the LLM authors directly — no tool search.
//
// NOTE: stdout is the MCP protocol channel — never console.log there. Use stderr.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { z } from "zod";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Project } from "../core/project";
import { pkgPath } from "../core/paths";
import { resolveWorkspaceRoot } from "../core/mcp-config";
import { applyPatch, type PatchOp } from "../core/patch";
import { validateDoc, type AnyDoc } from "../core/validate-doc";
import type { ValidationResult } from "../core/validate";
import { BRAND } from "../brand";

const URI = BRAND.uriScheme; // resource URI scheme: `${URI}://guide`

const EXAMPLE_SUFFIX = /\.(flow|sequence)\.json$/;
const flowSchemaUrl = pkgPath("schema", "flow.schema.json");
const sequenceSchemaUrl = pkgPath("schema", "sequence.schema.json");
const examplesDir = pkgPath("examples");

// The workspace is resolved PER CALL (the agent may pass `workspace`; a global
// server serves any project). See docs/mcp.md + discussion.md (2026-06-20, B).
function resolveRoot(callWorkspace?: string) {
  return resolveWorkspaceRoot({
    callWorkspace,
    envWorkspace: process.env[BRAND.envWorkspace],
    argvWorkspace: process.argv[2],
    scope: process.env[BRAND.envScope],
    cwd: process.cwd(),
  });
}

/** A Project for this call, or `error` text to return to the agent. */
function projectFor(callWorkspace?: string): { project?: Project; root?: string; error?: string } {
  const r = resolveRoot(callWorkspace);
  if (!r.root) return { error: r.error };
  return { project: new Project(r.root), root: r.root };
}

const errText = (text: string) => ({ content: [{ type: "text" as const, text }], isError: true as const });

// ---- text rendering of a validation result -----------------------------------

function renderResult(r: ValidationResult): string {
  if (r.ok && r.warnings.length === 0) return "✓ valid — no issues.";
  const lines: string[] = [r.ok ? "✓ valid (with warnings):" : "✗ invalid:"];
  for (const e of r.errors) lines.push(`  ERROR [${e.code}] ${e.message}${e.suggestion ? ` → ${e.suggestion}` : ""}`);
  for (const w of r.warnings) lines.push(`  WARN  [${w.code}] ${w.message}${w.suggestion ? ` (${w.suggestion})` : ""}`);
  return lines.join("\n");
}

// ---- tool input schemas (Zod shapes) ------------------------------------------

const idInput = { id: z.string().describe("Flow id (filename without .flow.json).") };

const modelShape = z
  .object({
    version: z.string(),
    id: z.string(),
    title: z.string(),
  })
  .passthrough()
  .describe(
    "A complete Flow OR Sequence document (discriminated by `kind`: omit/`flow` for a Flow, " +
      `\`sequence\` for a Sequence). See ${URI}://schema and ${URI}://sequence-schema for the ` +
      `JSON Schemas and ${URI}://guide for authoring rules. Validated server-side.`,
  );

const modelInput = { model: modelShape };

// Per-call write/read destination. Documents live under `<workspace>/<storeDir>`.
const workspaceInput = {
  workspace: z
    .string()
    .optional()
    .describe(
      `Absolute path of the PROJECT directory to operate in — documents live under its \`${BRAND.storeDir}/\` ` +
        "folder. Omit ONLY when the server already knows the project (it was launched there, e.g. Claude " +
        "Code). In a global client (e.g. Claude Desktop) you MUST pass it; if omitted the server returns " +
        "an error. If you do not know where to save, ASK THE USER. Pass the SAME value on every call.",
    ),
};

// ---- server -------------------------------------------------------------------

// Server `instructions` are delivered to the model by EVERY MCP client (unlike
// resources, which some clients don't surface). Keep this a concise always-on
// summary; the full guide/schema/examples remain as resources for richer clients.
const INSTRUCTIONS = `${BRAND.display}: visualize code flows as JSON documents at two altitudes — Flow (high: a
directed graph of steps; \`*.flow.json\`) and Sequence (low/exact: an ordered, nested call tree;
\`kind:"sequence"\`, \`*.sequence.json\`). You author these.

Tools:
- get_docs {topic} — the authoring guide / JSON Schemas / examples as TEXT. CALL THIS FIRST if you have
  not authored a ${BRAND.display} document before: \`topic:"guide"\` for the rules, \`"flow-schema"\` /
  \`"sequence-schema"\` for the exact contracts, \`"examples"\` to list/fetch samples. (It exists because
  some clients — e.g. Claude Desktop — expose MCP resources only to the user, not to you.)
- list_flows — what exists + \`workspaceRoot\` (the folder writes land in; check it if a write goes
  somewhere unexpected — a stale root means the server must be restarted with the right path).
- read_flow {id} — current JSON of one doc.
- validate_flow {model} — dry-run validation (structure + referential integrity + split heuristic).
- write_flow {model} — validate + write a WHOLE document (rejects on errors; writes + warnings else).
- patch_flow {id, ops[]} — SMALL edits by object id (set-field / upsert·remove node|edge|call); applies
  the delta, validates the whole result, then writes. Prefer this over resending the whole doc.
- manage_flow {action, id, ...} — lifecycle: delete | rename | set-category. Never move/delete files by
  hand (it bypasses validation).

Key rules: identity is the \`id\`, not the label (set \`shared:true\` for cross-flow identity). You pass a
document by \`id\` (never a file path) — docs are stored under \`<workspace>/${BRAND.storeDir}/\` automatically.
Where to save: pass \`workspace\` (absolute project dir) on the tools. If you omit it, the server uses the
project it was launched in (project-scoped clients, e.g. Claude Code) or returns an error (global clients,
e.g. Claude Desktop) — then pass the path of the project under discussion, or ask the user. Reuse the same
\`workspace\` across the conversation. Author the Flow first; add a Sequence (linked from a node/edge via
\`sequence\`) only where the exact call-trace helps.

Fuller guidance: call get_docs {topic:"guide"|"flow-schema"|"sequence-schema"|"examples"} (works in
every client), or read the matching MCP resources (${URI}://guide, ${URI}://schema,
${URI}://sequence-schema, ${URI}://examples/{name}) if your client surfaces resources to you.`;

const server = new McpServer({ name: BRAND.mcpName, version: "0.1.0" }, { instructions: INSTRUCTIONS });

server.registerTool(
  "get_docs",
  {
    title: "Get authoring docs",
    description:
      "Fetch the authoring guide, the JSON Schemas, or bundled examples as TEXT — the same material " +
      "as the MCP resources, but callable as a tool (some clients, e.g. Claude Desktop, expose " +
      "resources to the user only, not to the model). `topic`: 'guide' (authoring rules) | 'flow-schema' " +
      "| 'sequence-schema' (exact contracts) | 'examples'. For 'examples', omit `name` to list them, or " +
      "pass a `name` to fetch one. Call this before authoring if you are unsure of the format.",
    inputSchema: {
      topic: z.enum(["guide", "flow-schema", "sequence-schema", "examples"]).describe("Which document to fetch."),
      name: z.string().optional().describe("Example name (topic=examples); omit to list available examples."),
    },
  },
  async (args) => {
    const { topic, name } = args;
    const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });
    try {
      if (topic === "guide") return text(GUIDE);
      if (topic === "flow-schema") return text(readFileSync(flowSchemaUrl, "utf8"));
      if (topic === "sequence-schema") return text(readFileSync(sequenceSchemaUrl, "utf8"));
      // topic === "examples"
      if (!name) {
        const names = [...new Set(readdirSync(examplesDir).filter((f) => EXAMPLE_SUFFIX.test(f)).map((f) => f.replace(EXAMPLE_SUFFIX, "")))];
        return text(names.length ? `Available examples (pass one as \`name\`):\n${names.map((n) => `- ${n}`).join("\n")}` : "(no bundled examples)");
      }
      let body: string;
      try {
        body = readFileSync(pkgPath("examples", `${name}.flow.json`), "utf8");
      } catch {
        body = readFileSync(pkgPath("examples", `${name}.sequence.json`), "utf8");
      }
      return text(body);
    } catch (e) {
      return { content: [{ type: "text" as const, text: `Couldn't fetch ${topic}${name ? `/${name}` : ""}: ${String(e)}` }], isError: true };
    }
  },
);

server.registerTool(
  "list_flows",
  {
    title: "List documents",
    description:
      "List the documents in the workspace — flows and sequences (id + title + kind) — plus " +
      "`workspaceRoot` (the folder this server operates on; check it if writes land in an unexpected place).",
    inputSchema: { ...workspaceInput },
  },
  async (args) => {
    const { project, root, error } = projectFor(args.workspace);
    if (!project || !root) return errText(error ?? "No workspace set.");
    const flows = existsSync(root)
      ? (await project.entries()).map((e) => ({ id: e.id, title: e.title, kind: e.kind, category: e.category }))
      : [];
    const list = flows.length
      ? flows.map((f) => `- ${f.id} [${f.kind}] — ${f.title}${f.category ? ` (${f.category})` : ""}`).join("\n")
      : "(no documents yet)";
    const text = `workspace: ${root}\n${list}`;
    return { content: [{ type: "text", text }], structuredContent: { workspaceRoot: root, flows } };
  },
);

server.registerTool(
  "read_flow",
  { title: "Read document", description: "Return the current JSON of one document (flow or sequence), for incremental editing.", inputSchema: { ...idInput, ...workspaceInput } },
  async (args) => {
    const { id } = args;
    const { project, error } = projectFor(args.workspace);
    if (!project) return errText(error ?? "No workspace set.");
    try {
      const doc = await project.read(id);
      return { content: [{ type: "text", text: JSON.stringify(doc, null, 2) }], structuredContent: doc as unknown as Record<string, unknown> };
    } catch {
      return { content: [{ type: "text", text: `No document "${id}" in the workspace.` }], isError: true };
    }
  },
);

server.registerTool(
  "validate_flow",
  {
    title: "Validate flow",
    description:
      "Validate a Flow or Sequence document WITHOUT writing it. Dispatches by kind: flows get " +
      "structure (JSON Schema) + semantics (referential integrity, id uniqueness, shared-id " +
      "consistency, split heuristic, dangling drill targets); sequences get structure + call-id " +
      "uniqueness + actor/phase integrity. Returns errors + advisory warnings.",
    inputSchema: { ...modelInput, ...workspaceInput },
  },
  async (args) => {
    const model = args.model as unknown as AnyDoc;
    // Validating a candidate model must not require knowing where it will be saved:
    // with a workspace we run cross-flow checks; without one we validate standalone.
    const { project } = projectFor(args.workspace);
    const result = project ? await project.validate(model) : validateDoc(model, []);
    const note = project ? "" : "\n(validated standalone — no workspace set, cross-flow checks skipped)";
    return { content: [{ type: "text", text: renderResult(result) + note }], structuredContent: result as unknown as Record<string, unknown> };
  },
);

server.registerTool(
  "write_flow",
  {
    title: "Write flow",
    description:
      "Validate and write a document to <id>.flow.json or <id>.sequence.json (by its `kind`). " +
      "Rejects on hard errors (does NOT write); writes and returns advisory warnings otherwise. " +
      "Pass the whole document each time.",
    inputSchema: { ...modelInput, ...workspaceInput },
  },
  async (args) => {
    const model = args.model as unknown as AnyDoc;
    const { project, root, error } = projectFor(args.workspace);
    if (!project || !root) return errText(error ?? "No workspace set.");
    if (!existsSync(root)) return errText(`Workspace directory not found: ${root}. Pass an existing project directory as \`workspace\`.`);
    const result = await project.validate(model);
    if (!result.ok) {
      return {
        content: [{ type: "text", text: `Not written — fix the errors:\n${renderResult(result)}` }],
        structuredContent: { written: null, ...result } as unknown as Record<string, unknown>,
        isError: true,
      };
    }
    const dest = await project.write(model);
    return {
      content: [{ type: "text", text: `Wrote "${model.id}".\n${renderResult(result)}` }],
      structuredContent: { written: dest, ...result } as unknown as Record<string, unknown>,
    };
  },
);

server.registerTool(
  "manage_flow",
  {
    title: "Manage document (lifecycle)",
    description:
      "Document lifecycle/metadata — separate from content authoring. `action`: 'delete' (remove the " +
      "file + manifest entry), 'rename' (change the display title; needs `title`), 'set-category' " +
      "(logical, nested 'a/b'; needs `category`). For content use write_flow / patch_flow.",
    inputSchema: {
      action: z.enum(["delete", "rename", "set-category"]).describe("delete | rename | set-category"),
      id: z.string().describe("Document id."),
      title: z.string().optional().describe("New title (action=rename)."),
      category: z.string().optional().describe("Logical category, nested 'a/b' (action=set-category; '' = ungroup)."),
      ...workspaceInput,
    },
  },
  async (args) => {
    const { action, id, title, category } = args;
    const { project, root, error } = projectFor(args.workspace);
    if (!project || !root) return errText(error ?? "No workspace set.");
    if (!existsSync(root)) return errText(`Workspace directory not found: ${root}. Pass an existing project directory as \`workspace\`.`);
    const fail = (msg: string) => ({ content: [{ type: "text" as const, text: msg }], isError: true });
    try {
      if (action === "delete") {
        await project.remove(id);
        return { content: [{ type: "text" as const, text: `Deleted "${id}".` }] };
      }
      if (action === "rename") {
        if (title == null) return fail("rename needs `title`.");
        await project.rename(id, title);
        return { content: [{ type: "text" as const, text: `Renamed "${id}" → "${title}".` }] };
      }
      if (category == null) return fail("set-category needs `category`.");
      await project.setCategory(id, category);
      return { content: [{ type: "text" as const, text: `Set category of "${id}" → "${category || "(ungrouped)"}".` }] };
    } catch (e) {
      return fail(String(e));
    }
  },
);

server.registerTool(
  "patch_flow",
  {
    title: "Patch document (partial edit)",
    description:
      "Apply small edits to an existing document by object id — cheap (send only the delta), but the " +
      "WHOLE result is validated + written (rejects on errors, exactly like write_flow). `ops[]` items: " +
      "set-field {target:'doc'|'node'|'edge'|'call', id?, field, value} · upsert-node {node} · " +
      "remove-node {id} · upsert-edge {edge} · remove-edge {id} · upsert-call {call, parent?} · " +
      "remove-call {id}. Edges need an `id` to be patched. Use this instead of resending the whole " +
      "document for minor changes.",
    inputSchema: {
      id: z.string().describe("Document id to edit."),
      ops: z.array(z.object({ op: z.string() }).passthrough()).describe("Ordered edit operations (see description)."),
      ...workspaceInput,
    },
  },
  async (args) => {
    const id = args.id;
    const ops = args.ops as unknown as PatchOp[];
    const { project, root, error } = projectFor(args.workspace);
    if (!project || !root) return errText(error ?? "No workspace set.");
    if (!existsSync(root)) return errText(`Workspace directory not found: ${root}. Pass an existing project directory as \`workspace\`.`);
    let doc: AnyDoc;
    try {
      doc = await project.read(id);
    } catch {
      return { content: [{ type: "text" as const, text: `No document "${id}" in the workspace.` }], isError: true };
    }
    let patched: AnyDoc;
    try {
      patched = applyPatch(doc, ops);
    } catch (e) {
      return { content: [{ type: "text" as const, text: `Patch not applied: ${String(e)}` }], isError: true };
    }
    const result = await project.validate(patched);
    if (!result.ok) {
      return {
        content: [{ type: "text", text: `Not written — fix the errors:\n${renderResult(result)}` }],
        structuredContent: { written: null, ...result } as unknown as Record<string, unknown>,
        isError: true,
      };
    }
    const dest = await project.write(patched);
    return {
      content: [{ type: "text", text: `Patched "${patched.id}".\n${renderResult(result)}` }],
      structuredContent: { written: dest, ...result } as unknown as Record<string, unknown>,
    };
  },
);

// ---- resources (teaching surface) ---------------------------------------------

server.registerResource(
  "schema",
  `${URI}://schema`,
  { title: "Flow JSON Schema", description: "JSON Schema (draft 2020-12) for a Flow document.", mimeType: "application/schema+json" },
  async (uri) => ({ contents: [{ uri: uri.href, mimeType: "application/schema+json", text: readFileSync(flowSchemaUrl, "utf8") }] }),
);

server.registerResource(
  "sequence-schema",
  `${URI}://sequence-schema`,
  { title: "Sequence JSON Schema", description: "JSON Schema (draft 2020-12) for a Sequence document.", mimeType: "application/schema+json" },
  async (uri) => ({ contents: [{ uri: uri.href, mimeType: "application/schema+json", text: readFileSync(sequenceSchemaUrl, "utf8") }] }),
);

server.registerResource(
  "guide",
  `${URI}://guide`,
  { title: "Authoring guide", description: `How to author a ${BRAND.display} Flow document.`, mimeType: "text/markdown" },
  async (uri) => ({ contents: [{ uri: uri.href, mimeType: "text/markdown", text: GUIDE }] }),
);

server.registerResource(
  "examples",
  new ResourceTemplate(`${URI}://examples/{name}`, {
    list: async () => ({
      resources: readdirSync(examplesDir)
        .filter((f) => EXAMPLE_SUFFIX.test(f))
        .map((f) => {
          const name = f.replace(EXAMPLE_SUFFIX, "");
          return { uri: `${URI}://examples/${name}`, name, mimeType: "application/json" };
        }),
    }),
  }),
  { title: "Examples", description: "Bundled example flows and sequences." },
  async (uri, variables) => {
    const name = String(variables.name);
    const tryRead = (suffix: string) => readFileSync(pkgPath("examples", `${name}${suffix}`), "utf8");
    let text: string;
    try {
      text = tryRead(".flow.json");
    } catch {
      text = tryRead(".sequence.json");
    }
    return { contents: [{ uri: uri.href, mimeType: "application/json", text }] };
  },
);

const GUIDE = `# ${BRAND.display} — authoring a Flow document

A Flow document is one JSON file (\`<id>.flow.json\`) describing one behaviour at a
high altitude: a directed graph of steps, color-coded by which actor performs each.

## Shape
\`{ version:"1", id, title, layout?:"TB"|"LR", actors[], nodes[], edges[] }\`

- **actors**: every participant — human AND system. \`{ id, label, kind:human|system|service|infra, color? }\`.
- **nodes**: \`{ id, type, label, description, owner?, shared?, subflow?, inputs?, outputs?, source?, refs? }\`.
  - **type → shape**: terminal (start/end) · step (action) · decision (branch) ·
    subflow (drills into another flow; set \`subflow\` to that flow's id) · io (data).
  - **owner** (strongly recommended): the actor id that performs this step → its color. With more than
    one actor, set an owner on EVERY non-terminal node — otherwise the diagram has no color coding and
    the whole point of actors is lost (validate_flow warns: \`nodes-without-owner\`). Terminals (Start/
    Done) may stay neutral.
  - **description** (required): a LIST OF POINTS (\`string[]\`) — one thesis per item, NOT one
    blob. Rendered as bullets. Depth is your call, guided by the user.
  - **inputs/outputs** (opt): \`{name, type?}[]\`. **source** (opt): \`{file?, symbol?, line?}\` for
    code. **refs** (opt): \`{label, url}[]\` for external docs/links (non-code systems).
- **edges**: \`{ from, to, type, label? }\` — type: flow · branch (label = condition) · return.
  An edge is a **first-class object like a node**: it may also carry optional \`id\`, \`description\`
  (string[]), \`inputs\`/\`outputs\`, \`source\`, \`refs\`, \`shared\`, and \`subflow\` (drill into a flow
  describing the whole transition). Edge \`id\` shares the node id-namespace (unique across nodes+edges).

## Identity (read this — it is where authoring breaks)
Identity is the **id**, not the label. Two nodes may share a label if their ids differ.
- ids are **per-flow local by default** — the same id in two flows does NOT collide.
- Set \`shared:true\` to make an id **workspace-global**: the same shared id in other
  flows is the SAME object (enables cross-flow tracing). Use it deliberately.
- Avoid: false merge (two different things, one id) and false split (one thing, two ids).
  validate_flow flags both — it suggests "promote to @shared" for likely splits.

## Convention
A readable flow has a **Start** terminal (entry; a \`terminal\` node with no incoming edges)
and a **Done** terminal (exit; no outgoing edges). validate_flow advises (warning) if either
is missing — it never blocks, but prefer including them.

## Sequence documents (the low / exact level)
A **Sequence** is the other altitude: an ordered, nested record of real execution, rendered as a
sequence diagram. Set \`kind:"sequence"\` and use \`*.sequence.json\`. Shape:
\`{ version:"1", kind:"sequence", id, title, actors[], phases?[], calls[] }\`.
- **actors** = lifelines (same shape as a flow's). **phases** (opt): \`{id,label}\` section separators.
- **calls**: a TREE — \`{ id, to, method, from?, phase?, description?, params?, returns?, returnType?,
  request?, response?, source?, refs?, async?, children?[] }\`. Only \`to\`+\`method\` required.
  Pre-order traversal = chronological order; nesting (\`children\`) = call-stack/activation depth.
- A Flow step links down to a Sequence via the node/edge \`sequence\` field (like \`subflow\`).
- Schema: ${URI}://sequence-schema. The same read/write/validate/list tools handle both kinds.

## Where documents are saved
Documents live under \`<workspace>/${BRAND.storeDir}/\`, where **workspace** is the project directory you are
documenting. Pass it as the \`workspace\` argument on the tools:
- **Project-scoped clients** (e.g. Claude Code, launched inside the repo): you may omit \`workspace\` — the
  server uses the directory it was started in.
- **Global clients** (e.g. Claude Desktop, one server for everything): you MUST pass \`workspace\`; omitting
  it returns an error (the server cannot guess). Pass the absolute path of the project under discussion;
  if you don't know it, ASK THE USER. Reuse the same value on every call.
The document content never contains machine paths — only the write destination is a runtime argument.

## Workflow & tools
- Whole document → \`write_flow\` (validates first; rejects on errors, else writes + warnings).
  \`validate_flow\` = dry run. See ${URI}://schema for the contract.
- **Small change → \`patch_flow\`** (edit by object id: set-field / upsert·remove node/edge/call). It
  applies your delta, validates the WHOLE result, then writes — far cheaper than resending the doc and
  it does NOT skip validation. Prefer it for minor edits.
- **Lifecycle → \`manage_flow\`** (action: delete | rename | set-category). Don't move/delete files by
  hand — that bypasses validation (drill targets silently break).
- **Check \`workspaceRoot\`** (from \`list_flows\`) if a write lands somewhere unexpected — it is the
  folder this server operates on; if stale, restart the server with the right path.
- New documents are stored under \`${BRAND.storeDir}/\` automatically — you pass only an \`id\`, never a path.

## When to drill down vs inline (editorial)
- **Description bullet** — *explanation* of a step (what/why), not a separate action.
- **Another node in the SAME flow** — steps at the *same altitude* (one narrative).
- **Drill into a sub-flow** (\`type:subflow\`) — a step that is itself a *multi-step sub-process* worth
  its own diagram, or reused across flows.
- **Flow vs Sequence** — Flow = "how the process works" (high); Sequence = "exact calls / order /
  params" (debug/precision). Author Flow first; add a Sequence (linked via \`sequence\`) only where the
  exact call-trace earns its keep.
- **subflow vs sequence asymmetry** — \`subflow\` is gated to \`type:subflow\` (the node IS a sub-flow
  box); \`sequence\` may sit on ANY node/edge (orthogonal drill to that step's exact execution).
  validate flags a **dangling subflow/sequence** target (warning) if the linked doc isn't present yet.
- **Explain drill-down to the human** when you use it ("I split this into linked levels — click *Open*
  on a step to go deeper"); many users meet drill-down here for the first time.
`;

async function main() {
  await server.connect(new StdioServerTransport());
  const scope = process.env[BRAND.envScope] ?? "(unset)";
  console.error(`[${BRAND.key}] MCP server on stdio — scope=${scope}, cwd=${process.cwd()}`);
}

main().catch((err) => {
  console.error(`[${BRAND.key}] fatal:`, err);
  process.exit(1);
});
