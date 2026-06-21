import { defineConfig } from "tsup";

// Bundles the Node-side entries (CLI + MCP server) into runnable plain-JS files
// in dist/, so end users don't need tsx/TypeScript. Runtime `dependencies` stay
// external (installed by npm); only our own source is bundled. The browser
// renderer is built separately by Vite (`build:renderer` → dist-renderer/).
export default defineConfig({
  entry: { cli: "src/cli/index.ts", mcp: "src/mcp/server.ts" },
  format: ["esm"],
  platform: "node",
  target: "node18",
  outDir: "dist",
  clean: true,
  splitting: false,
  shims: false,
});
