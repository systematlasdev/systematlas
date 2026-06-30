import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import os from "node:os";
import { pkgPath } from "./paths";
import { BRAND } from "../brand";

// MCP onboarding: detect which agents are present, then generate/write a config
// so an agent can author flow-trace documents. We model a config *shape* (file
// format + top-level key) rather than per-client code:
//   JSON · "mcpServers"       → Claude Code, Cursor, Windsurf, Claude Desktop
//   JSON · "servers"          → VS Code (Copilot)
//   JSON · "context_servers"  → Zed
//   TOML · "mcp_servers"      → Codex
// "Detected" agents carry a verified footprint path — the rest fall back to a
// labelled default ("common location — verify with your client") or Custom.
// See docs/mcp-onboarding.md.

export interface McpSchema {
  format: "json" | "toml";
  /** Top-level key under which servers are declared. */
  key: string;
}

export interface McpSpec {
  command: string;
  args: string[];
  /** Extra env for the server process (e.g. the scope marker for project-scoped configs). */
  env?: Record<string, string>;
}

// Generated configs use the portable, shareable form `npx -y systematlas-mcp`.
// Set LOCAL_DEV = true only for local development from a checkout (absolute
// `node <abs>/dist/mcp.js` path instead).
const LOCAL_DEV = false;

const fwd = (p: string): string => p.replace(/\\/g, "/");
const reEscape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const home = (...segs: string[]): string => join(os.homedir(), ...segs);
const exists = (p: string): boolean => {
  try {
    return existsSync(p);
  } catch {
    return false;
  }
};

/** Expand a leading ~ to the home dir. */
export function expandHome(p: string): string {
  return p.startsWith("~") ? resolve(os.homedir(), p.slice(1).replace(/^[\\/]/, "")) : resolve(p);
}

/** Is `child` the same as or inside `parent`? */
function isInside(child: string, parent: string): boolean {
  const c = resolve(child);
  const p = resolve(parent);
  return c === p || c.startsWith(p.endsWith(sep) ? p : p + sep);
}

/**
 * The MCP server invocation. We NEVER bake a workspace path into the args (a baked
 * path is an accident of first-init and goes stale). Instead:
 *  - project-scoped config (lives inside the project) → carry the scope marker
 *    `FLOW_TRACE_SCOPE=project`, telling the server it may trust cwd (the client
 *    launches a project-local config with cwd = that project).
 *  - global config (Desktop, ~/...) → no marker, no path. The server then requires
 *    the agent to pass `workspace` per call (or it returns an active error).
 * See docs/mcp.md (workspace resolution) and discussion.md (2026-06-20, B).
 */
export function mcpServerSpec(opts: { projectScoped: boolean }): McpSpec {
  const cmd: McpSpec = LOCAL_DEV
    ? { command: "node", args: [fwd(pkgPath("dist", "mcp.js"))] }
    : { command: "npx", args: ["-y", BRAND.mcpPackage] };
  return opts.projectScoped ? { ...cmd, env: { [BRAND.envScope]: "project" } } : cmd;
}

/** Is a config at `location` project-scoped (lives inside the project we document)?
 *  One geometric check — host-agnostic; works for known agents and Custom paths. */
export function isProjectScoped(location: string, workspaceDir: string): boolean {
  return isInside(expandHome(location), resolve(workspaceDir));
}

export interface ResolveInput {
  /** Per-call `workspace` argument from the agent (strongest). */
  callWorkspace?: string;
  /** FLOW_TRACE_WORKSPACE env. */
  envWorkspace?: string;
  /** Legacy baked path (process.argv[2]) — back-compat with pre-B configs. */
  argvWorkspace?: string;
  /** FLOW_TRACE_SCOPE env ("project" → trust cwd). */
  scope?: string;
  /** process.cwd(). */
  cwd: string;
}

export interface WorkspaceResolution {
  /** Resolved absolute root, when determinable. */
  root?: string;
  /** Agent-facing guidance when the workspace can't be determined. */
  error?: string;
}

/**
 * Decide which folder the server operates on for one call (pure — no fs).
 * Order: explicit (call > env > legacy argv) → else cwd IF scope=project → else error.
 * Absence of the scope marker is the SAFE default: never guess cwd, ask instead.
 */
export function resolveWorkspaceRoot(i: ResolveInput): WorkspaceResolution {
  const explicit = [i.callWorkspace, i.envWorkspace, i.argvWorkspace].map((s) => s?.trim()).find(Boolean);
  if (explicit) return { root: expandHome(explicit) };
  if (i.scope === "project") return { root: resolve(i.cwd) };
  return {
    error:
      "No workspace set. Pass `workspace` = the absolute path of the project directory you are " +
      'documenting (e.g. "E:/code/my-project"). If you do not know it, ask the user where to save. ' +
      "Reuse the same path on every call.",
  };
}

const SERVER_NAME = BRAND.mcpName;

// Candidate claude_desktop_config.json locations, most-specific first. The
// MSIX/Microsoft Store build virtualizes %APPDATA%\Roaming under
// AppData\Local\Packages\<pkg>\LocalCache\Roaming\Claude — so we glob the
// Claude* package(s) and fall back to the classic installer's Roaming path.
function claudeDesktopCandidates(): string[] {
  if (process.platform === "darwin") return [home("Library", "Application Support", "Claude", "claude_desktop_config.json")];
  if (process.platform !== "win32") return [home(".config", "Claude", "claude_desktop_config.json")];
  const out: string[] = [];
  const packages = home("AppData", "Local", "Packages");
  try {
    for (const d of readdirSync(packages)) {
      if (/^Claude/i.test(d)) out.push(join(packages, d, "LocalCache", "Roaming", "Claude", "claude_desktop_config.json"));
    }
  } catch {
    /* no Packages dir */
  }
  out.push(home("AppData", "Roaming", "Claude", "claude_desktop_config.json")); // classic installer
  return out;
}

// Write target: prefer an existing config, else a path whose Claude dir exists,
// else the classic Roaming path (created on demand).
function claudeDesktopPath(): string {
  const c = claudeDesktopCandidates();
  return c.find(exists) ?? c.find((p) => exists(dirname(p))) ?? c[c.length - 1];
}

// Lenient presence check — the config file often doesn't exist until the first
// MCP server is added, so a present Claude* package or Claude config dir counts.
function claudeDesktopPresent(): boolean {
  if (process.platform === "win32") {
    try {
      if (readdirSync(home("AppData", "Local", "Packages")).some((d) => /^Claude/i.test(d))) return true;
    } catch {
      /* none */
    }
  }
  return claudeDesktopCandidates().some((p) => exists(p) || exists(dirname(p)));
}

interface AgentDef {
  id: string;
  label: string;
  schema: McpSchema;
  writable: boolean; // false → shared/OS file: offer Copy, never auto-write
  location: (projectDir: string) => string; // display path (~ kept for home configs)
  detect: (projectDir: string) => boolean; // footprint present on this machine/project?
  // The app owns its config in memory and rewrites the file on exit — so an
  // external write while it is RUNNING gets clobbered. Connect with it closed.
  guiManaged?: boolean;
}

const JSON_MCP: McpSchema = { format: "json", key: "mcpServers" };

const REGISTRY: AgentDef[] = [
  {
    id: "claude-code",
    label: "Claude Code",
    schema: JSON_MCP,
    writable: true,
    location: (d) => `${fwd(resolve(d))}/.mcp.json`,
    detect: (d) => exists(join(d, ".mcp.json")) || exists(home(".claude.json")) || exists(home(".claude")),
  },
  {
    id: "cursor",
    label: "Cursor",
    schema: JSON_MCP,
    writable: true,
    location: (d) => `${fwd(resolve(d))}/.cursor/mcp.json`,
    detect: (d) => exists(join(d, ".cursor")) || exists(home(".cursor")),
  },
  {
    id: "windsurf",
    label: "Windsurf",
    schema: JSON_MCP,
    writable: true,
    location: () => "~/.codeium/windsurf/mcp_config.json",
    detect: () => exists(home(".codeium", "windsurf")),
  },
  {
    id: "antigravity",
    label: "Antigravity",
    schema: JSON_MCP, // Google Antigravity IDE — JSON, "mcpServers" key, command/args/env
    writable: true,
    location: () => "~/.gemini/antigravity/mcp_config.json",
    detect: () => exists(home(".gemini", "antigravity")),
  },
  {
    id: "vscode",
    label: "VS Code",
    schema: { format: "json", key: "servers" },
    writable: true,
    location: (d) => `${fwd(resolve(d))}/.vscode/mcp.json`,
    detect: (d) => exists(join(d, ".vscode")),
  },
  {
    id: "codex",
    label: "Codex",
    schema: { format: "toml", key: "mcp_servers" },
    writable: true,
    location: () => "~/.codex/config.toml",
    detect: () => exists(home(".codex")),
  },
  {
    id: "claude-desktop",
    label: "Claude Desktop",
    schema: JSON_MCP,
    writable: true, // single JSON config — auto-merge (falls back to Copy if unparseable)
    location: () => fwd(claudeDesktopPath()),
    detect: () => claudeDesktopPresent(),
    guiManaged: true, // rewrites its config on exit → connect while it is closed
  },
  {
    id: "zed",
    label: "Zed",
    schema: { format: "json", key: "context_servers" },
    writable: true, // merges if settings.json is plain JSON; Copy if it has comments
    location: () => (process.platform === "win32" ? fwd(home("AppData", "Roaming", "Zed", "settings.json")) : "~/.config/zed/settings.json"),
    detect: () => exists(home(".config", "zed")) || exists(home("AppData", "Roaming", "Zed")) || exists(home(".zed")),
  },
];

/** Serializable agent option for the CLI / browser. */
export interface AgentInfo {
  id: string;
  label: string;
  location: string;
  schema: McpSchema;
  present: boolean;
  writable: boolean;
  /** This agent's config already declares flow-trace. */
  configured: boolean;
  /** The app rewrites its own config on exit → connect while it is closed. */
  guiManaged: boolean;
}

/** All known agents, each annotated with its config location, whether a footprint
 *  is present here, and whether flow-trace is already wired into its config. */
export function detectAgents(projectDir: string): AgentInfo[] {
  return REGISTRY.map((a) => {
    const location = a.location(projectDir);
    const configured = isFlowTraceConfigured(expandHome(location), a.schema);
    return { id: a.id, label: a.label, location, schema: a.schema, present: a.detect(projectDir), writable: a.writable, configured, guiManaged: !!a.guiManaged };
  });
}

// ---- rendering / merging by schema -------------------------------------------

function renderToml(schema: McpSchema, spec: McpSpec): string {
  const args = spec.args.map((a) => `'${a}'`).join(", ");
  let out = `[${schema.key}.${SERVER_NAME}]\ncommand = '${spec.command}'\nargs = [${args}]`;
  if (spec.env && Object.keys(spec.env).length) {
    const env = Object.entries(spec.env).map(([k, v]) => `${k} = '${v}'`).join(", ");
    out += `\nenv = { ${env} }`;
  }
  return out;
}

/** The flow-trace entry as a copy-paste snippet for an existing config. */
export function snippetFor(schema: McpSchema, spec: McpSpec): string {
  if (schema.format === "toml") return renderToml(schema, spec);
  return JSON.stringify({ [schema.key]: { [SERVER_NAME]: spec } }, null, 2);
}

function renderFull(schema: McpSchema, spec: McpSpec): string {
  return snippetFor(schema, spec) + "\n";
}

function appendBlock(content: string, block: string): string {
  const trimmedRight = content.replace(/\s*$/, "");
  return (trimmedRight ? `${trimmedRight}\n\n` : "") + block + "\n";
}

/** Does this config text already declare a flow-trace server under `schema.key`? */
export function hasFlowTrace(content: string, schema: McpSchema): boolean {
  if (schema.format === "toml") return new RegExp(`^\\s*\\[${reEscape(schema.key)}\\.${reEscape(SERVER_NAME)}\\]\\s*(?:#.*)?$`, "m").test(content);
  try {
    const obj = JSON.parse(content) as Record<string, Record<string, unknown> | undefined>;
    return !!obj[schema.key] && Object.prototype.hasOwnProperty.call(obj[schema.key], SERVER_NAME);
  } catch {
    return new RegExp(`"${SERVER_NAME}"\\s*:`).test(content);
  }
}

/** Is flow-trace wired into this config at all? Since B, a global server is
 *  folder-agnostic (it resolves the workspace per call), so the mere presence of a
 *  flow-trace entry means "connected" — for both project-scoped and global configs. */
function isFlowTraceConfigured(absLocation: string, schema: McpSchema): boolean {
  try {
    return hasFlowTrace(readFileSync(absLocation, "utf8"), schema);
  } catch {
    return false;
  }
}

export type SetupStatus = "written" | "merged" | "already" | "conflict";
export interface SetupResult {
  status: SetupStatus;
  path: string;
  snippet: string;
}

export interface SetupInput {
  location: string;
  schema: McpSchema;
  workspaceDir: string;
  /** Compute the snippet without touching disk (for shared/OS configs → Copy). */
  dryRun?: boolean;
}

/**
 * Write or merge a flow-trace MCP entry into the target config.
 * - missing file → written · present + ours → already
 * - present + JSON → merged (parse, add under schema.key)
 * - present + TOML → merged by appending a new server table
 */
export function setupMcp(input: SetupInput): SetupResult {
  const path = expandHome(input.location);
  // Config inside the project → project-scoped: scope marker, rely on cwd.
  // Config outside (global, ~/...) → no marker; server requires per-call workspace.
  const projectScoped = isProjectScoped(input.location, input.workspaceDir);
  const spec = mcpServerSpec({ projectScoped });
  const snippet = snippetFor(input.schema, spec);

  if (input.dryRun) return { status: "conflict", path, snippet };

  if (!exists(path)) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, renderFull(input.schema, spec), "utf8");
    return { status: "written", path, snippet };
  }

  const content = readFileSync(path, "utf8");
  if (hasFlowTrace(content, input.schema)) return { status: "already", path, snippet };

  if (input.schema.format === "json") {
    let obj: Record<string, Record<string, unknown>>;
    try {
      obj = JSON.parse(content);
    } catch {
      return { status: "conflict", path, snippet };
    }
    obj[input.schema.key] = { ...(obj[input.schema.key] ?? {}), [SERVER_NAME]: spec };
    writeFileSync(path, JSON.stringify(obj, null, 2) + "\n", "utf8");
    return { status: "merged", path, snippet };
  }

  writeFileSync(path, appendBlock(content, snippet), "utf8");
  return { status: "merged", path, snippet };
}

/** Best-effort "is an agent already wired up here?" — scans the common project configs. */
export function detectConfigured(projectDir: string): { configured: boolean; path?: string } {
  const candidates: Array<{ p: string; s: McpSchema }> = [
    { p: resolve(projectDir, ".mcp.json"), s: JSON_MCP },
    { p: resolve(projectDir, ".cursor", "mcp.json"), s: JSON_MCP },
    { p: resolve(projectDir, ".vscode", "mcp.json"), s: { format: "json", key: "servers" } },
  ];
  for (const c of candidates) {
    try {
      if (existsSync(c.p) && hasFlowTrace(readFileSync(c.p, "utf8"), c.s)) return { configured: true, path: c.p };
    } catch {
      /* skip */
    }
  }
  return { configured: false };
}
