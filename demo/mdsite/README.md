# mdsite

A tiny, **zero-dependency** static site generator — the demo project for
[flow-trace](../../). It exists so flow-trace has a real codebase to visualize:
a clear top-level Flow, parallel sub-flows, and a drill-down into a Sequence with
genuinely reused helper calls.

## Use

```sh
node src/cli.js build            # reads ./content, writes ./site
node src/cli.js build --src docs --out public
```

No install, no build step — plain Node ESM (Node 18+).

## How it works

`build()` orchestrates the pipeline:

1. **loadConfig** — defaults ← `mdsite.config.json` ← CLI flags, validated.
2. **discover** — find every `*.md` under `content/`.
3. **buildPage** (per file) — read → parse frontmatter → render Markdown → apply layout → write HTML.
4. **copyAssets** — copy non-Markdown files (e.g. CSS) verbatim.
5. **writeSitemap** — emit `sitemap.xml` from the built pages.

The Markdown renderer (`markdown.js`) is hand-written: `tokenize` → `renderToken`
(per block) → `renderInline`, which calls the shared helpers `escapeHtml` and
`resolveLink` (also reused by the layout and the sitemap) — the reuse that
flow-trace highlights with ×N badges.

## Layout

| File | Role |
|------|------|
| `src/cli.js` | argv parsing → `build()` |
| `src/build.js` | orchestrates the phases (the top Flow) |
| `src/config.js` | load + merge + validate config |
| `src/discover.js` | find Markdown files |
| `src/page.js` | per-page pipeline + layout |
| `src/markdown.js` | tokenize + render (the per-token loop) |
| `src/html.js` | `escapeHtml`, `resolveLink` (reused helpers) |
| `src/assets.js` | copy static assets |
| `src/sitemap.js` | write `sitemap.xml` |
