import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

// Two build modes:
//   default       → normal dist/ (used for typecheck/verification)
//   --mode singlefile → one self-contained HTML in dist-renderer/ — the renderer
//                       template consumed by the CLI (`serve` serves it; `build`
//                       injects flow JSON into it). One renderer, two outputs.
export default defineConfig(({ mode }) => {
  const single = mode === "singlefile";
  return {
    plugins: [react(), ...(single ? [viteSingleFile()] : [])],
    build: single ? { outDir: "dist-renderer", emptyOutDir: true } : {},
  };
});
