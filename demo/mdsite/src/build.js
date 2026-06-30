// The orchestrator — this is the top-level Flow the SystemAtlas diagram describes:
// load config → discover content → build each page → copy assets → write sitemap.

import { loadConfig } from "./config.js";
import { discover } from "./discover.js";
import { buildPage } from "./page.js";
import { copyAssets } from "./assets.js";
import { writeSitemap } from "./sitemap.js";

export async function build(overrides = {}) {
  const cfg = await loadConfig(overrides);
  const files = await discover(cfg.srcDir);

  // Build every discovered page (the per-page loop → drills into a sub-flow).
  const pages = [];
  for (const file of files) {
    pages.push(await buildPage(cfg, file));
  }

  // Independent branch: copy static assets (its own sub-flow).
  const assets = await copyAssets(cfg);

  // Finalize: sitemap from the built pages.
  const urlCount = await writeSitemap(cfg, pages);

  console.log(`mdsite: built ${pages.length} page(s), copied ${assets.length} asset(s), ${urlCount} sitemap URL(s) → ${cfg.outDir}/`);
  return { cfg, pages, assets, urlCount };
}
