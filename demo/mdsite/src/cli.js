#!/usr/bin/env node
// mdsite CLI entry — `mdsite build [--src content] [--out site]`.

import { build } from "./build.js";

const args = process.argv.slice(2);
const cmd = args[0] ?? "build";

function flag(name, fallback) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

if (cmd !== "build") {
  console.error("usage: mdsite build [--src <dir>] [--out <dir>]");
  process.exit(1);
}

const overrides = {};
const src = flag("--src", null);
const out = flag("--out", null);
if (src) overrides.srcDir = src;
if (out) overrides.outDir = out;

build(overrides).catch((err) => {
  console.error("mdsite: build failed —", err.message);
  process.exit(1);
});
