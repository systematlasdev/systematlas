// Single source of truth for the product's name and derived identifiers.
//
// To rebrand the whole tool later:
//   1. change KEY (+ DISPLAY) below,
//   2. push the OLD storeDir onto `legacyStoreDirs` so existing projects keep
//      being read,
//   3. update `name` / `bin` in package.json to match (the one place that can't
//      import this module).
// Everything else in the codebase derives from BRAND, so a rename is a one-spot
// edit. Pure constants, no imports → safe to use from Node AND the browser.

const KEY = "systematlas"; // lowercase slug: npm name, CLI, MCP server, URI scheme
const DISPLAY = "SystemAtlas"; // human-facing name (CLI intro, UI copy)
const ALIASES = ["sysatlas"]; // additional CLI command names

const UPPER = KEY.toUpperCase().replace(/[^A-Z0-9]/g, "_");

export const BRAND = {
  /** lowercase slug used for machine identifiers */
  key: KEY,
  /** human-facing name */
  display: DISPLAY,
  /** primary CLI command */
  cli: KEY,
  /** extra CLI command names (aliases) */
  cliAliases: ALIASES,
  /** MCP server name + the key under which it is declared in a client config */
  mcpName: KEY,
  /** published MCP launcher: `npx -y systematlas-mcp` */
  mcpPackage: `${KEY}-mcp`,
  /** resource URI scheme: `systematlas://guide` */
  uriScheme: KEY,
  /** per-project storage dir: `.systematlas/` */
  storeDir: `.${KEY}`,
  /** older storage dirs to ALSO read (so a rename never strands existing data) */
  legacyStoreDirs: [".flowtrace"] as string[],
  /** env var marking a project-scoped launch (trust cwd) */
  envScope: `${UPPER}_SCOPE`,
  /** env var giving an explicit workspace dir */
  envWorkspace: `${UPPER}_WORKSPACE`,
  /** build-time injected browser global holding embedded flows */
  globalVar: `__${UPPER}__`,
} as const;

/** All storage dirs to READ from (current first), for locating docs after a rename. */
export const STORE_DIRS: string[] = [BRAND.storeDir, ...BRAND.legacyStoreDirs];
