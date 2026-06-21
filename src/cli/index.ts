#!/usr/bin/env node
// flow-trace CLI — `serve` (dev server + live reload) and `build` (self-contained
// HTML). Both consume the pre-built renderer template (docs/cli.md, concepts.md §11).
import { resolve } from "node:path";
import { runServe } from "./serve";
import { runBuild } from "./build";
import { setupMcp, snippetFor, mcpServerSpec, detectAgents, isProjectScoped, type McpSchema } from "../core/mcp-config";
import { BRAND } from "../brand";

type Flags = Record<string, string | boolean>;

function parseFlags(args: string[]): { positionals: string[]; flags: Flags } {
  const positionals: string[] = [];
  const flags: Flags = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("--")) {
      const body = a.slice(2);
      if (body.startsWith("no-")) {
        flags[body.slice(3)] = false;
      } else if (body.includes("=")) {
        const eq = body.indexOf("=");
        flags[body.slice(0, eq)] = body.slice(eq + 1);
      } else {
        const next = args[i + 1];
        if (next !== undefined && !next.startsWith("--")) {
          flags[body] = next;
          i++;
        } else {
          flags[body] = true;
        }
      }
    } else {
      positionals.push(a);
    }
  }
  return { positionals, flags };
}

const C = BRAND.cli;
const USAGE = `${BRAND.display} — visualize code flows

Usage:
  ${C}                                    interactive menu (in a terminal)
  ${C} serve [dir|file] [--port 4321] [--host 127.0.0.1] [--no-open] [--strict-port]
  ${C} build [dir|file] [--out <dir>] [--minify] [--split]
  ${C} init  [dir] [--location <path>] [--format json|toml]

  serve   dev server + browser; watches *.flow.json / *.sequence.json and live-reloads in place.
          no arg → current folder as workspace; <file> → a single document.
  build   self-contained HTML (renderer + embedded JSON).
          dir → ./dist/index.html (whole workspace; drill-down works). --split → one file per doc.
          <file> → <id>.html next to it.
  init    wire up an MCP config so an agent can author here (Claude Code / Cursor / Codex).

(also available as '${BRAND.cliAliases.join("', '")}')`;

const DOC_SUFFIX = /\.(flow|sequence)\.json$/;

// Bare `flow-trace` in a real terminal → a friendly pick-an-action menu.
// Returns the chosen action (run by main, after clack tears down) or null.
async function interactive(): Promise<"serve" | "build" | "init" | null> {
  const p = await import("@clack/prompts");
  const { readdirSync } = await import("node:fs");
  let count = 0;
  try {
    count = readdirSync(process.cwd()).filter((f) => DOC_SUFFIX.test(f)).length;
  } catch {
    /* unreadable cwd → 0 */
  }
  const hint = count ? `${count} document(s) in this folder` : "no *.flow.json / *.sequence.json here yet";
  p.intro(BRAND.display);
  const action = await p.select({
    message: `What would you like to do?  (${hint})`,
    options: [
      { value: "serve", label: "serve", hint: "open in the browser + live reload" },
      { value: "build", label: "build", hint: "self-contained HTML to share" },
      { value: "init", label: "init", hint: "connect an agent (MCP config)" },
      { value: "quit", label: "quit" },
    ],
  });
  if (p.isCancel(action) || action === "quit") {
    p.cancel("Bye.");
    return null;
  }
  // Only PICK the action here — run it from main() AFTER clack has fully torn down
  // its stdin/readline. Running a long-lived server inside the clack flow let the
  // process exit prematurely; the direct `serve` command path does not.
  return action as "serve" | "build" | "init";
}

// `flow-trace init` — detect agents, then write/merge an MCP config so an agent
// can author here (or print a snippet to paste).
async function runInit(positionals: string[], flags: Flags): Promise<void> {
  const projectDir = resolve(positionals[0] ?? ".");
  const buildSchema = (fmt: string | undefined, key?: string): McpSchema => {
    const format = fmt === "toml" ? "toml" : "json";
    return { format, key: key ?? (format === "toml" ? "mcp_servers" : "mcpServers") };
  };

  let location: string;
  let schema: McpSchema;
  let writable = true;

  const explicitLoc = typeof flags.location === "string" ? flags.location : undefined;
  if (explicitLoc) {
    location = explicitLoc;
    const fmt = typeof flags.format === "string" ? flags.format : explicitLoc.endsWith(".toml") ? "toml" : "json";
    schema = buildSchema(fmt, typeof flags.key === "string" ? flags.key : undefined);
  } else if (process.stdout.isTTY) {
    const p = await import("@clack/prompts");
    const agents = detectAgents(projectDir);
    const detected = agents.filter((a) => a.present);
    const others = agents.filter((a) => !a.present);
    const opt = (a: (typeof agents)[number]) => ({ value: a.id, label: a.present ? `${a.label}  ✓ detected` : a.label, hint: a.location });
    const choice = await p.select({
      message: "Connect which agent?",
      options: [...detected.map(opt), ...others.map(opt), { value: "custom", label: "Custom…" }],
    });
    if (p.isCancel(choice)) {
      p.cancel("Cancelled.");
      return;
    }
    if (choice === "custom") {
      const loc = await p.text({ message: "Config file path", placeholder: "./.mcp.json" });
      if (p.isCancel(loc)) return;
      location = String(loc);
      const fmt = await p.select({ message: "Format", options: [{ value: "json", label: "JSON" }, { value: "toml", label: "TOML" }] });
      if (p.isCancel(fmt)) return;
      let key: string | undefined;
      if (fmt === "json") {
        const k = await p.select({
          message: "JSON key",
          options: [
            { value: "mcpServers", label: "mcpServers (Claude Code, Cursor, Windsurf, Desktop)" },
            { value: "servers", label: "servers (VS Code)" },
            { value: "context_servers", label: "context_servers (Zed)" },
          ],
        });
        if (p.isCancel(k)) return;
        key = k as string;
      }
      schema = buildSchema(fmt as string, key);
    } else {
      const a = agents.find((x) => x.id === choice)!;
      location = a.location;
      schema = a.schema;
      writable = a.writable;
      if (a.guiManaged) {
        console.log(
          `! ${a.label} rewrites its own config when it exits — quit it COMPLETELY (incl. the tray/\n` +
            `  background process, not just the window) before continuing, or this entry will be discarded.\n`,
        );
      }
    }
  } else {
    location = `${projectDir.replace(/\\/g, "/")}/.mcp.json`;
    schema = buildSchema("json");
  }

  if (!writable) {
    const snippet = snippetFor(schema, mcpServerSpec({ projectScoped: isProjectScoped(location, projectDir) }));
    console.log(`! ${location} is a shared/OS config — add this entry yourself:\n\n${snippet}`);
    return;
  }

  const res = setupMcp({ location, schema, workspaceDir: projectDir });
  if (res.status === "written") console.log(`✓ Wrote MCP config → ${res.path}`);
  else if (res.status === "merged") console.log(`✓ Added ${BRAND.display} to ${res.path}`);
  else if (res.status === "already") console.log(`✓ Already configured in ${res.path}`);
  else console.log(`! ${res.path} already exists — add this entry manually:\n\n${res.snippet}`);
  if (res.status !== "conflict") console.log(`\nRestart your agent to load the ${BRAND.display} MCP server.`);
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);

  if (!cmd) {
    if (!process.stdout.isTTY) {
      console.log(USAGE);
      return;
    }
    // Pick the action via the menu, then run it here (after clack has torn down).
    const action = await interactive();
    // Neutralize any leftover prompt stdin state so a long-lived server isn't
    // killed by a stray keypress handler / raw-mode remnant.
    try {
      if (process.stdin.isTTY) process.stdin.setRawMode(false);
      process.stdin.removeAllListeners("keypress");
      process.stdin.pause();
    } catch {
      /* best-effort */
    }
    if (action === "serve") {
      const envPort = process.env.PORT ? Number(process.env.PORT) : undefined;
      await runServe({ port: envPort ?? 4321, host: "127.0.0.1", open: true });
    } else if (action === "build") {
      await runBuild({ minify: false });
    } else if (action === "init") {
      await runInit([], {});
    }
    return;
  }

  const { positionals, flags } = parseFlags(rest);

  switch (cmd) {
    case "serve": {
      const envPort = process.env.PORT ? Number(process.env.PORT) : undefined;
      await runServe({
        target: positionals[0],
        port: flags.port ? Number(flags.port) : (envPort ?? 4321),
        host: typeof flags.host === "string" ? flags.host : "127.0.0.1",
        open: flags.open !== false,
        strictPort: flags["strict-port"] === true,
      });
      break;
    }
    case "build":
      await runBuild({
        target: positionals[0],
        out: typeof flags.out === "string" ? flags.out : undefined,
        minify: flags.minify === true || flags.minify === "true",
        split: flags.split === true,
      });
      break;
    case "init":
      await runInit(positionals, flags);
      break;
    case "help":
    case "-h":
    case "--help":
      console.log(USAGE);
      break;
    default:
      console.log(USAGE);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(String(err instanceof Error ? err.message : err));
  process.exit(1);
});
