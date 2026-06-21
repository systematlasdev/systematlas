import http from "node:http";
import path from "node:path";
import os from "node:os";
import { promises as fs } from "node:fs";
import { spawn } from "node:child_process";
import chokidar, { type FSWatcher } from "chokidar";
import { Project } from "../core/project";
import type { AnyDoc } from "../core/validate-doc";
import { detectConfigured, detectAgents, setupMcp, type McpSchema } from "../core/mcp-config";
import { readTemplate } from "./template";
import { BRAND } from "../brand";

const SUFFIX_RE = /\.(flow|sequence)\.json$/;
const MANIFEST_RE = new RegExp(`[\\\\/]${BRAND.storeDir.replace(/[.]/g, "\\.")}[\\\\/]project\\.json$`);
const RECENTS_FILE = path.join(os.homedir(), BRAND.storeDir, "recents.json");

export interface ServeOptions {
  target?: string; // dir (workspace) or a single .flow.json / .sequence.json file
  port: number;
  host: string;
  open: boolean;
  /** Fail if `port` is busy instead of auto-incrementing to the next free one. */
  strictPort?: boolean;
}

function idFromPath(p: string): string {
  return path.basename(p).replace(SUFFIX_RE, "");
}

function openUrl(url: string): void {
  const platform = process.platform;
  if (platform === "win32") spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
  else if (platform === "darwin") spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
  else spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
}

// Native OS folder picker. `serve` is a local backend, so it can pop the real
// desktop dialog (the browser sandbox can't return an absolute path). Per-OS:
// Windows → FolderBrowserDialog, macOS → `choose folder`, Linux → zenity.
// Resolves to the chosen absolute path, or null if cancelled / unavailable.
function pickFolderDialog(): Promise<string | null> {
  const platform = process.platform;
  let cmd: string;
  let args: string[];
  if (platform === "win32") {
    cmd = "powershell";
    // Windows refuses to foreground a window from a process that didn't get the
    // last input ("foreground lock"), so a plain TopMost owner isn't enough — we
    // create a real (off-screen) owner form and SetForegroundWindow it, then own
    // the dialog with it so the dialog comes to the front of the browser.
    args = [
      "-NoProfile",
      "-WindowStyle",
      "Hidden",
      "-STA",
      "-Command",
      "Add-Type -AssemblyName System.Windows.Forms,System.Drawing; " +
        "Add-Type -Name Fg -Namespace Win -MemberDefinition '[DllImport(\"user32.dll\")] public static extern bool SetForegroundWindow(System.IntPtr h);'; " +
        "$o = New-Object System.Windows.Forms.Form; $o.TopMost = $true; $o.ShowInTaskbar = $false; $o.StartPosition = 'Manual'; " +
        "$o.Location = New-Object System.Drawing.Point(-3000, -3000); $o.Size = New-Object System.Drawing.Size(1, 1); " +
        "$o.Show(); [Win.Fg]::SetForegroundWindow($o.Handle) | Out-Null; " +
        `$d = New-Object System.Windows.Forms.FolderBrowserDialog; $d.Description = 'Select a ${BRAND.display} project folder'; ` +
        "$r = $d.ShowDialog($o); $o.Dispose(); " +
        "if ($r -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($d.SelectedPath) }",
    ];
  } else if (platform === "darwin") {
    cmd = "osascript";
    args = ["-e", `POSIX path of (choose folder with prompt "Select a ${BRAND.display} project folder")`];
  } else {
    cmd = "zenity";
    args = ["--file-selection", "--directory", `--title=Select a ${BRAND.display} project folder`];
  }
  return new Promise((resolve) => {
    let proc;
    try {
      proc = spawn(cmd, args);
    } catch {
      resolve(null);
      return;
    }
    let out = "";
    proc.stdout?.on("data", (c) => (out += c));
    proc.on("error", () => resolve(null));
    proc.on("close", (code) => {
      const picked = out.trim();
      resolve(code === 0 && picked ? picked : null);
    });
  });
}

// Listen on `startPort`, auto-incrementing past busy ports (Vite-style) so a
// stray server never crashes us with a raw EADDRINUSE stack. Resolves to the
// actual bound port; rejects (cleanly) on any other listen error.
function listenWithFallback(server: http.Server, host: string, startPort: number, attempts = 20): Promise<number> {
  return new Promise((resolve, reject) => {
    let port = startPort;
    let tried = 0;
    const onError = (e: NodeJS.ErrnoException) => {
      if (e.code === "EADDRINUSE" && tried < attempts) {
        tried++;
        port++;
        server.listen(port, host);
      } else if (e.code === "EADDRINUSE") {
        reject(
          new Error(
            attempts === 0
              ? `Port ${startPort} is already in use (--strict-port). Free it or pick another with --port.`
              : `No free port in ${startPort}..${startPort + attempts}.`,
          ),
        );
      } else {
        reject(e);
      }
    };
    server.on("error", onError);
    server.listen(port, host, () => {
      server.removeListener("error", onError);
      resolve(port);
    });
  });
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

async function loadRecents(): Promise<string[]> {
  try {
    const arr = JSON.parse(await fs.readFile(RECENTS_FILE, "utf8"));
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}
async function addRecent(dir: string): Promise<void> {
  const prev = await loadRecents();
  const next = [dir, ...prev.filter((p) => p !== dir)].slice(0, 10);
  try {
    await fs.mkdir(path.dirname(RECENTS_FILE), { recursive: true });
    await fs.writeFile(RECENTS_FILE, JSON.stringify(next, null, 2) + "\n", "utf8");
  } catch {
    /* recents are best-effort */
  }
}

export async function runServe(opts: ServeOptions): Promise<void> {
  // A stray error — e.g. an OS file-watch error on a large/locked folder chosen via
  // open-project — must never kill the dev server. Log and carry on.
  process.on("uncaughtException", (e) => console.error(`[${BRAND.key}] uncaught exception:`, e));
  process.on("unhandledRejection", (e) => console.error(`[${BRAND.key}] unhandled rejection:`, e));

  const single = !!opts.target && SUFFIX_RE.test(opts.target);
  let projectDir = single ? path.dirname(path.resolve(opts.target!)) : path.resolve(opts.target ?? process.cwd());
  const onlyId = single ? idFromPath(opts.target!) : null;

  let project = new Project(projectDir);
  // Re-read the renderer on each page load so a `build:renderer` rebuild shows up
  // on a plain refresh (no serve restart needed). Keep the last good copy as a
  // fallback for the brief window where the file is missing/partial mid-rebuild.
  let template = readTemplate();
  const currentTemplate = (): string => {
    try {
      template = readTemplate();
    } catch {
      /* mid-rebuild / transient read error → serve the last good copy */
    }
    return template;
  };
  const clients = new Set<http.ServerResponse>();

  const broadcast = (msg: unknown) => {
    const data = `data: ${JSON.stringify(msg)}\n\n`;
    for (const c of clients) c.write(data);
  };

  const json = (res: http.ServerResponse, code: number, body: unknown) => {
    res.writeHead(code, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };

  // --- live reload watcher (re-created on open-project) -------------------------
  const onChange = async (filePath: string) => {
    // Manual manifest edits (categories / name / document set) → refresh the listing.
    if (MANIFEST_RE.test(filePath)) {
      broadcast({ type: "project-changed" });
      return;
    }
    if (!SUFFIX_RE.test(filePath)) return;
    const id = idFromPath(filePath);
    if (onlyId && id !== onlyId) return;
    try {
      const doc = await project.read(id);
      const result = await project.validate(doc);
      if (!result.ok) broadcast({ type: "error", message: `"${id}": ${result.errors.map((e) => e.message).join("; ")}` });
      else broadcast({ type: "flow-updated", id, doc });
    } catch (e) {
      broadcast({ type: "error", message: `"${id}" could not be read: ${String(e)}` });
    }
  };
  // chokidar MUST have an "error" handler — without one, a watch error (EPERM/
  // ENOENT on some subdir of a large/system folder) is an unhandled EventEmitter
  // "error" and crashes the process. This was killing serve on open-project.
  const makeWatcher = (dir: string): FSWatcher =>
    chokidar
      .watch(dir, { ignoreInitial: true, depth: 1 })
      .on("add", onChange)
      .on("change", onChange)
      .on("error", (e) => console.error(`[${BRAND.key}] watch error: ${String(e)}`));
  let watcher: FSWatcher = makeWatcher(projectDir);

  // --- project listing -----------------------------------------------------------
  const projectPayload = async () => {
    const m = await project.loadManifest();
    const documents = (await project.entries()).filter((d) => !onlyId || d.id === onlyId);
    return { name: m?.name ?? path.basename(projectDir), root: projectDir, documents };
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    const p = url.pathname;
    const method = req.method ?? "GET";

    if (p === "/" || p === "/index.html") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(currentTemplate());
      return;
    }

    // Back-compat list (id/title/kind) + the richer project endpoint.
    if (p === "/api/flows") {
      const { documents } = await projectPayload();
      return json(res, 200, documents.map((d) => ({ id: d.id, title: d.title, kind: d.kind })));
    }
    if (p === "/api/project") {
      return json(res, 200, await projectPayload());
    }
    if (p === "/api/recents") {
      return json(res, 200, await loadRecents());
    }

    // --- MCP onboarding: status (configured?) + write/merge a config -----------
    if (p === "/api/mcp-status") {
      return json(res, 200, { ...detectConfigured(projectDir), agents: detectAgents(projectDir) });
    }
    if (p === "/api/setup-mcp" && method === "POST") {
      try {
        const { location, schema, dryRun } = JSON.parse(await readBody(req)) as { location: string; schema: McpSchema; dryRun?: boolean };
        return json(res, 200, setupMcp({ location, schema, workspaceDir: projectDir, dryRun }));
      } catch (e) {
        return json(res, 400, { error: String(e) });
      }
    }

    if (p.startsWith("/api/flow/")) {
      const id = decodeURIComponent(p.slice("/api/flow/".length));
      try {
        return json(res, 200, await project.read(id));
      } catch (e) {
        return json(res, 400, { error: `Cannot read "${id}": ${String(e)}` });
      }
    }

    // --- writes (serve is the file-access backend; build is read-only) ----------
    if (p.startsWith("/api/doc/")) {
      const rest = p.slice("/api/doc/".length);
      const [rawId, action] = rest.split("/");
      const id = decodeURIComponent(rawId);
      try {
        if (method === "PUT" && !action) {
          const doc = JSON.parse(await readBody(req)) as AnyDoc;
          const result = await project.validate(doc);
          if (!result.ok) return json(res, 400, result);
          await project.write(doc);
          broadcast({ type: "flow-updated", id: doc.id, doc });
          broadcast({ type: "project-changed" });
          return json(res, 200, { ok: true, warnings: result.warnings });
        }
        if (method === "POST" && action === "rename") {
          const { title } = JSON.parse(await readBody(req)) as { title: string };
          await project.rename(id, title);
          broadcast({ type: "project-changed" });
          return json(res, 200, { ok: true });
        }
        if (method === "POST" && action === "category") {
          const { category } = JSON.parse(await readBody(req)) as { category: string };
          await project.setCategory(id, category);
          broadcast({ type: "project-changed" });
          return json(res, 200, { ok: true });
        }
        if (method === "DELETE" && !action) {
          await project.remove(id);
          broadcast({ type: "project-changed" });
          return json(res, 200, { ok: true });
        }
      } catch (e) {
        return json(res, 400, { error: String(e) });
      }
      return json(res, 405, { error: "method not allowed" });
    }

    if (p === "/api/category/rename" && method === "POST") {
      try {
        const { from, to } = JSON.parse(await readBody(req)) as { from: string; to: string };
        await project.renameCategory(from, to);
        broadcast({ type: "project-changed" });
        return json(res, 200, { ok: true });
      } catch (e) {
        return json(res, 400, { error: String(e) });
      }
    }

    if (p === "/api/pick-folder" && method === "POST") {
      const picked = await pickFolderDialog();
      return json(res, 200, { path: picked });
    }

    // In-browser folder navigator (reliable cross-OS; no native dialog z-order woes).
    if (p === "/api/list-dir") {
      const target = url.searchParams.get("path");
      const dir = target ? path.resolve(target) : projectDir;
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        const dirs = entries
          .filter((e) => e.isDirectory() && e.name !== "node_modules")
          .map((e) => e.name)
          .sort((a, b) => a.localeCompare(b));
        const parent = path.dirname(dir);
        return json(res, 200, { path: dir.replace(/\\/g, "/"), parent: parent === dir ? null : parent.replace(/\\/g, "/"), dirs });
      } catch (e) {
        return json(res, 400, { error: String(e) });
      }
    }

    if (p === "/api/open-project" && method === "POST") {
      try {
        const { path: target } = JSON.parse(await readBody(req)) as { path: string };
        const dir = path.resolve(target);
        const stat = await fs.stat(dir);
        if (!stat.isDirectory()) return json(res, 400, { error: "not a directory" });
        projectDir = dir;
        project = new Project(dir);
        await watcher.close();
        watcher = makeWatcher(dir);
        await addRecent(dir);
        broadcast({ type: "project-changed" });
        return json(res, 200, await projectPayload());
      } catch (e) {
        return json(res, 400, { error: String(e) });
      }
    }

    if (p === "/api/events") {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
      res.write(":\n\n");
      clients.add(res);
      const keepalive = setInterval(() => res.write(":\n\n"), 25000);
      req.on("close", () => {
        clearInterval(keepalive);
        clients.delete(res);
      });
      return;
    }

    res.writeHead(404);
    res.end("Not found");
  });

  await addRecent(projectDir);
  const port = await listenWithFallback(server, opts.host, opts.port, opts.strictPort ? 0 : 20);
  const urlStr = `http://${opts.host}:${port}/`;
  console.log(`${BRAND.display} serve — project: ${projectDir}${onlyId ? ` (document: ${onlyId})` : ""}`);
  if (port !== opts.port) console.log(`  (port ${opts.port} was busy — using ${port})`);
  console.log(`  ${urlStr}  (live reload on *.flow.json / *.sequence.json changes)`);
  if (opts.open) openUrl(urlStr);
}
