// Config loading: defaults ← optional mdsite.config.json ← CLI overrides, validated.

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const DEFAULTS = {
  title: "My Site",
  baseUrl: "/",
  srcDir: "content",
  outDir: "site",
};

/** Load + merge + validate the effective config. */
export async function loadConfig(overrides = {}) {
  let fromFile = {};
  try {
    fromFile = JSON.parse(await readFile(resolve("mdsite.config.json"), "utf8"));
  } catch {
    // no config file → defaults only
  }
  const cfg = { ...DEFAULTS, ...fromFile, ...overrides };
  validateConfig(cfg);
  return cfg;
}

function validateConfig(cfg) {
  if (!cfg.baseUrl.startsWith("/") && !/^https?:\/\//.test(cfg.baseUrl)) {
    throw new Error(`config.baseUrl must be root-relative ("/...") or absolute ("https://..."): got "${cfg.baseUrl}"`);
  }
  if (!cfg.srcDir || !cfg.outDir) {
    throw new Error("config.srcDir and config.outDir are required");
  }
}
