# SystemAtlas

> Visualize how your code actually flows — authored by an AI agent, at two altitudes.

[![Live demo](https://img.shields.io/badge/▶-Live%20demo-5e54a8)](https://systematlasdev.github.io/systematlas/)
[![npm](https://img.shields.io/npm/v/systematlas.svg)](https://www.npmjs.com/package/systematlas)
[![license](https://img.shields.io/npm/l/systematlas.svg)](./LICENSE)

### ▶ Try it live: **https://systematlasdev.github.io/systematlas/**

The build pipeline of a tiny static-site generator — parallel drill-downs and a Sequence with reuse badges. Click **Open** on a step to dive in.

[![SystemAtlas — Flow view](https://raw.githubusercontent.com/systematlasdev/systematlas/main/docs/img/screen_1.png)](https://systematlasdev.github.io/systematlas/)

*A **Flow** — the high-level graph, color-coded by actor. Select a step to see its description, I/O and a link to the source; drill down into a sub-flow or a Sequence.*

[![SystemAtlas — Sequence view](https://raw.githubusercontent.com/systematlasdev/systematlas/main/docs/img/screen_2.png)](https://systematlasdev.github.io/systematlas/)

*A **Sequence** — the exact call trace, with ×N reuse badges and a minimap.*

[![Export project to one self-contained HTML](https://raw.githubusercontent.com/systematlasdev/systematlas/main/docs/img/screen_3.png)](https://systematlasdev.github.io/systematlas/)

*Export the whole workspace to one self-contained HTML — from the CLI (`build`) or the sidebar's **Export project** menu.*

SystemAtlas turns a behaviour in your codebase into an interactive diagram at two levels of detail:

- **Flow** — high level: a directed graph of steps, branches and returns, color-coded by actor. *How the process works.*
- **Sequence** — low level: every call, with params/returns and source refs, as a sequence diagram. *The exact call-by-call trace.*

A Flow step can **drill down** into a sub-flow, and any step into a Sequence — so one diagram can carry the whole story, from the bird's-eye view to the precise calls.

Documents are plain JSON (with a JSON Schema), **authored by an LLM over MCP** and rendered in the browser. Cross-platform — only Node 18+ and a browser.

## Quick start

```bash
# in a folder with *.flow.json / *.sequence.json documents:
npx systematlas serve      # opens the diagram in your browser, with live reload
npx systematlas build      # bakes a self-contained ./dist/index.html — share by file
```

Or install once:

```bash
npm install -g systematlas
systematlas serve          # (also available as `sysatlas`)
systematlas                # no args, in a terminal → interactive menu
```

## Authoring with an agent (MCP)

SystemAtlas ships an MCP server so an LLM can create / edit / validate documents directly.
Register it in your MCP client (Claude Code, Cursor, Claude Desktop, …):

```jsonc
{
  "mcpServers": {
    "systematlas": { "command": "npx", "args": ["-y", "systematlas-mcp"] }
  }
}
```

The loop: the agent writes JSON over MCP → `serve` live-reloads the browser. Tools:
`get_docs` · `list_flows` · `read_flow` · `write_flow` · `patch_flow` · `validate_flow` · `manage_flow`,
plus Resources for the schema, an authoring guide and examples. Ask your agent, e.g.:

> Use SystemAtlas to draw a Flow (and a Sequence where the exact calls matter) of how *X* works, and save it in this project.

## Commands

```
systematlas serve [dir|file] [--port 4321] [--host 127.0.0.1] [--no-open] [--strict-port]
systematlas build [dir|file] [--out <dir>] [--minify] [--split]
systematlas init  [dir] [--location <path>] [--format json|toml]
```

- **`serve`** — local dev server + browser. Watches documents and re-renders **in place** (keeps zoom/selection).
- **`build`** — bakes the renderer + documents into **one self-contained `index.html`** (offline, drill-down works). `--split` → one file per document; `<file>` → a single `<id>.html`. You can also export from the sidebar's **Export project** menu while serving.
- **`init`** — wire up the MCP config for your agent.

## How it works

One JSON model is the source of truth; the HTML renderer only reads it. The renderer is pre-built
once (Vite, single file); `serve` serves it and pushes updates over SSE, `build` embeds the JSON
into it. One renderer, two outputs — no duplication.

## Development

```bash
npm install
npm run dev              # Vite dev server (bundled examples)
npm run cli -- serve     # run the CLI from source (tsx)
npm run mcp              # run the MCP server from source
npm test                 # unit tests
npm run build            # typecheck + renderer bundle + CLI bundle (publishable)
npm link                 # make `systematlas` / `sysatlas` available globally from this checkout
```

## Authors

SystemAtlas is built by **Todor Rusev** and **Silviya Ruzhina**.

## License

[MIT](./LICENSE) © 2026 Todor Rusev, Silviya Ruzhina
