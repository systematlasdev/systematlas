import { test } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { resolveWorkspaceRoot, mcpServerSpec, snippetFor, isProjectScoped, expandHome, detectAgents } from "./mcp-config";
import { BRAND } from "../brand";

// ---- resolveWorkspaceRoot (pure resolution, the heart of B) -------------------

test("resolveWorkspaceRoot: explicit call workspace wins over env/argv", () => {
  const r = resolveWorkspaceRoot({
    callWorkspace: "C:/call",
    envWorkspace: "C:/env",
    argvWorkspace: "C:/argv",
    scope: "project",
    cwd: "C:/cwd",
  });
  assert.equal(r.root, expandHome("C:/call"));
  assert.equal(r.error, undefined);
});

test("resolveWorkspaceRoot: env used when no call arg", () => {
  const r = resolveWorkspaceRoot({ envWorkspace: "C:/env", argvWorkspace: "C:/argv", cwd: "C:/cwd" });
  assert.equal(r.root, expandHome("C:/env"));
});

test("resolveWorkspaceRoot: legacy argv path is honored (back-compat)", () => {
  const r = resolveWorkspaceRoot({ argvWorkspace: "C:/argv", cwd: "C:/cwd" });
  assert.equal(r.root, expandHome("C:/argv"));
});

test("resolveWorkspaceRoot: scope=project falls back to cwd", () => {
  const r = resolveWorkspaceRoot({ scope: "project", cwd: "C:/work/proj" });
  assert.equal(r.root, resolve("C:/work/proj"));
});

test("resolveWorkspaceRoot: global (no scope, nothing explicit) → active error, no root", () => {
  const r = resolveWorkspaceRoot({ cwd: "C:/somewhere" });
  assert.equal(r.root, undefined);
  assert.ok(r.error && /workspace/i.test(r.error));
});

test("resolveWorkspaceRoot: blank strings are ignored", () => {
  const r = resolveWorkspaceRoot({ callWorkspace: "   ", scope: "project", cwd: "C:/cwd" });
  assert.equal(r.root, resolve("C:/cwd"));
});

// ---- mcpServerSpec (never bakes a path; marks project scope) ------------------

test("mcpServerSpec: project-scoped carries the scope marker, no baked path", () => {
  const spec = mcpServerSpec({ projectScoped: true });
  assert.equal(spec.env?.[BRAND.envScope], "project");
  // The invariant: no SECOND (workspace) arg is baked. In LOCAL_DEV the only arg is
  // the server script; in publish mode it's `-y <mcpPackage>` — never a project path.
  assert.ok(spec.args.every((a) => a.endsWith("mcp.js") || a === "-y" || a === BRAND.mcpPackage));
});

test("mcpServerSpec: global has no scope marker", () => {
  const spec = mcpServerSpec({ projectScoped: false });
  assert.equal(spec.env, undefined);
});

// ---- snippetFor renders env in both formats ----------------------------------

test("snippetFor: JSON includes the scope marker for project-scoped", () => {
  const snippet = snippetFor({ format: "json", key: "mcpServers" }, mcpServerSpec({ projectScoped: true }));
  assert.ok(snippet.includes(BRAND.envScope));
  assert.ok(snippet.includes('"mcpServers"'));
});

test("snippetFor: global JSON has no env block", () => {
  const snippet = snippetFor({ format: "json", key: "mcpServers" }, mcpServerSpec({ projectScoped: false }));
  assert.ok(!snippet.includes(BRAND.envScope));
});

test("snippetFor: TOML includes env for project-scoped", () => {
  const snippet = snippetFor({ format: "toml", key: "mcp_servers" }, mcpServerSpec({ projectScoped: true }));
  assert.ok(new RegExp(`env\\s*=\\s*\\{[^}]*${BRAND.envScope}`).test(snippet));
});

// ---- isProjectScoped (geometric, host-agnostic) ------------------------------

test("isProjectScoped: config inside the project is project-scoped", () => {
  assert.equal(isProjectScoped("C:/proj/.mcp.json", "C:/proj"), true);
  assert.equal(isProjectScoped("C:/proj/.cursor/mcp.json", "C:/proj"), true);
});

test("isProjectScoped: config outside the project is global", () => {
  assert.equal(isProjectScoped("C:/Users/me/AppData/Roaming/Claude/claude_desktop_config.json", "C:/proj"), false);
});

// ---- guiManaged flag (clobber warning) ---------------------------------------

test("detectAgents: Claude Desktop is gui-managed; Claude Code is not", () => {
  const agents = detectAgents("C:/proj");
  const desktop = agents.find((a) => a.id === "claude-desktop");
  const code = agents.find((a) => a.id === "claude-code");
  assert.equal(desktop?.guiManaged, true);
  assert.equal(code?.guiManaged, false);
});

test("detectAgents: includes Antigravity (Google IDE) with its ~/.gemini config", () => {
  const a = detectAgents("C:/proj").find((x) => x.id === "antigravity");
  assert.ok(a, "antigravity agent present");
  assert.equal(a?.label, "Antigravity");
  assert.equal(a?.schema.key, "mcpServers");
  assert.ok(a?.location.includes(".gemini/antigravity/mcp_config.json"), `location: ${a?.location}`);
});
