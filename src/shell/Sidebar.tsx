import { useState } from "react";
import { tokens } from "../tokens";
import { BRAND } from "../brand";
import type { DocMeta, McpStatus, McpSetupResult, McpSchema, DirListing, BuildResult } from "../data/source";
import {
  IconChevronRight,
  IconClose,
  IconDots,
  IconFlowKind,
  IconFolder,
  IconLink,
  IconMenu,
  IconPencil,
  IconSeqKind,
  IconSidebar,
  IconTag,
  IconTrash,
} from "./icons";

interface SidebarProps {
  flows: DocMeta[];
  activeFlow: string;
  projectName: string;
  canWrite: boolean;
  recents: string[];
  open: boolean;
  onToggle: () => void;
  onSelectFlow: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onSetCategory: (id: string, category: string) => void;
  onRenameCategory: (from: string, to: string) => void;
  onDelete: (id: string) => void;
  onOpenProject: (path: string) => void;
  onPickFolder: () => Promise<string | null>;
  onListDir: (path?: string) => Promise<DirListing>;
  /** child doc id → parent doc id (drill-down lineage). */
  parents: Record<string, string>;
  mcp: McpStatus | null;
  onSetupMcp: (location: string, schema: McpSchema, dryRun?: boolean) => Promise<McpSetupResult>;
  /** Export the whole workspace as one self-contained HTML; resolves to its path. */
  onBuild: () => Promise<BuildResult>;
  /** Reveal a file/folder in the OS file manager. */
  onReveal: (target: string) => Promise<void>;
  /** Expanded width (px) + drag-the-right-edge handler. */
  width?: number;
  onResizeStart?: (e: React.PointerEvent) => void;
}

// Logical category tree — categories are nested strings ("a/b"); "" = ungrouped.
interface CatNode {
  name: string;
  path: string;
  children: Map<string, CatNode>;
  docs: DocMeta[];
}

function buildTree(flows: DocMeta[]): CatNode {
  const root: CatNode = { name: "", path: "", children: new Map(), docs: [] };
  for (const f of flows) {
    const segs = (f.category ?? "")
      .split("/")
      .map((s) => s.trim())
      .filter(Boolean);
    if (!segs.length) {
      root.docs.push(f);
      continue;
    }
    let cur = root;
    let acc = "";
    for (const seg of segs) {
      acc = acc ? `${acc}/${seg}` : seg;
      let child = cur.children.get(seg);
      if (!child) {
        child = { name: seg, path: acc, children: new Map(), docs: [] };
        cur.children.set(seg, child);
      }
      cur = child;
    }
    cur.docs.push(f);
  }
  return root;
}

const titleKey = (f: DocMeta) => (f.title || f.id).toLowerCase();

function KindIcon({ kind, size = 16 }: { kind: DocMeta["kind"]; size?: number }) {
  return kind === "sequence" ? <IconSeqKind size={size} /> : <IconFlowKind size={size} />;
}

const headerLabel: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: tokens.color.muted2,
};

type PopState =
  | { kind: "doc"; f: DocMeta; top: number; right: number; mode: "menu" | "rename" | "category" | "delete" }
  | { kind: "cat"; path: string; name: string; top: number; right: number; mode: "menu" | "rename" }
  | null;

export function Sidebar(props: SidebarProps) {
  const { flows, activeFlow, projectName, canWrite, recents, parents, mcp, open, onToggle, onSelectFlow } = props;
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [pop, setPop] = useState<PopState>(null);
  const [draft, setDraft] = useState("");
  const [opOpen, setOpOpen] = useState(false);
  const [opPath, setOpPath] = useState("");
  // In-browser folder navigator (reliable cross-OS; replaces the native dialog).
  const [navListing, setNavListing] = useState<DirListing | null>(null);
  const [navBusy, setNavBusy] = useState(false);
  const loadDir = async (path?: string) => {
    setNavBusy(true);
    try {
      setNavListing(await props.onListDir(path));
    } catch {
      /* keep previous listing */
    } finally {
      setNavBusy(false);
    }
  };
  // MCP onboarding panel state
  const [mcpOpen, setMcpOpen] = useState(false);
  const [mcpBusy, setMcpBusy] = useState(false);
  const [mcpResult, setMcpResult] = useState<McpSetupResult | null>(null);
  const [customOpen, setCustomOpen] = useState(false);
  const [customLoc, setCustomLoc] = useState("");
  const [customFmt, setCustomFmt] = useState<"json" | "toml">("json");
  const [customKey, setCustomKey] = useState("mcpServers");
  const [mcpChosen, setMcpChosen] = useState<{ label: string; location: string; schema: McpSchema; guiManaged?: boolean } | null>(null);
  // Share / export state
  const [shareOpen, setShareOpen] = useState(false);
  const [building, setBuilding] = useState(false);
  const [buildResult, setBuildResult] = useState<BuildResult | null>(null);
  const [buildErr, setBuildErr] = useState<string | null>(null);
  const doExport = async () => {
    setBuilding(true);
    setBuildErr(null);
    try {
      const r = await props.onBuild();
      setBuildResult(r);
    } catch (e) {
      setBuildErr(String(e instanceof Error ? e.message : e));
    } finally {
      setBuilding(false);
      setShareOpen(false);
    }
  };

  const doSetupMcp = async (location: string, schema: McpSchema, dryRun?: boolean) => {
    setMcpBusy(true);
    try {
      setMcpResult(await props.onSetupMcp(location, schema, dryRun));
    } catch (e) {
      setMcpResult({ status: "conflict", path: location, snippet: `# ${String(e)}` });
    } finally {
      setMcpBusy(false);
    }
  };

  const toggleCat = (path: string) =>
    setCollapsed((s) => {
      const next = new Set(s);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  // --- collapsed rail -----------------------------------------------------------
  if (!open) {
    return (
      <aside
        style={{
          flex: `0 0 ${tokens.size.sidebarRail}px`,
          width: tokens.size.sidebarRail,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          background: tokens.color.sidebar,
          borderRight: `1px solid ${tokens.color.border}`,
          padding: "12px 0",
        }}
      >
        <button className="ft-quiet" style={{ width: 36, height: 36, borderRadius: 8 }} title="Expand" onClick={onToggle}>
          <IconMenu />
        </button>
        <div style={{ width: 28, height: 1, background: tokens.color.border, margin: "10px 0" }} />
        <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "center", overflowY: "auto" }}>
          {flows.map((f) => (
            <button
              key={f.id}
              className={`ft-rail${f.id === activeFlow ? " ft-rail-active" : ""}`}
              title={f.title || f.id}
              onClick={() => onSelectFlow(f.id)}
            >
              <span style={{ color: f.id === activeFlow ? tokens.color.violet : "#A39A82", display: "flex" }}>
                <KindIcon kind={f.kind} size={17} />
              </span>
            </button>
          ))}
        </div>
        {canWrite ? (
          <button
            className="ft-newflow"
            style={{ width: 36, height: 36, borderRadius: 9, justifyContent: "center", marginTop: "auto" }}
            title="Open project"
            onClick={onToggle}
          >
            <IconFolder size={16} />
          </button>
        ) : null}
      </aside>
    );
  }

  // --- expanded panel -----------------------------------------------------------
  const root = buildTree(flows);

  const anchor = (e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return { top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) };
  };
  const openDocMenu = (e: React.MouseEvent, f: DocMeta) =>
    setPop({ kind: "doc", f, ...anchor(e), mode: "menu" });
  const openCatMenu = (e: React.MouseEvent, node: CatNode) =>
    setPop({ kind: "cat", path: node.path, name: node.name, ...anchor(e), mode: "menu" });

  const toMode = (mode: "rename" | "category" | "delete") => {
    if (!pop) return;
    if (pop.kind === "doc") {
      if (mode === "rename") setDraft(pop.f.title || pop.f.id);
      if (mode === "category") setDraft(pop.f.category ?? "");
      setPop({ ...pop, mode });
    } else if (mode === "rename") {
      setDraft(pop.name);
      setPop({ ...pop, mode });
    }
  };
  const commit = () => {
    if (!pop) return;
    if (pop.kind === "doc") {
      if (pop.mode === "rename") {
        const v = draft.trim();
        if (v && v !== pop.f.title) props.onRename(pop.f.id, v);
      } else if (pop.mode === "category") {
        props.onSetCategory(pop.f.id, draft.trim());
      }
    } else if (pop.mode === "rename") {
      // Rename a category's leaf segment, keeping its parent path.
      const leaf = draft.trim();
      const parent = pop.path.includes("/") ? pop.path.slice(0, pop.path.lastIndexOf("/")) : "";
      const to = [parent, leaf].filter(Boolean).join("/");
      if (leaf && to !== pop.path) props.onRenameCategory(pop.path, to);
    }
    setPop(null);
  };

  // depth = drill-down nesting level (0 = root). Subordinates get a leading ↳ and
  // are indented under their parent; the parent's parentTitle drives the tooltip.
  const docRow = (f: DocMeta, depth: number): React.ReactNode => {
    const active = f.id === activeFlow;
    const parentId = parents[f.id];
    const parentTitle = parentId ? (flows.find((x) => x.id === parentId)?.title ?? parentId) : null;
    return (
      <div key={f.id} className={active ? "ft-doc ft-doc-active" : "ft-doc"}>
        <button
          className="ft-docmain"
          title={depth > 0 && parentTitle ? `${f.id} — sub-flow of ${parentTitle}` : f.id}
          onClick={() => onSelectFlow(f.id)}
          style={{ paddingLeft: 10 + depth * 16 }}
        >
          {depth > 0 ? <span style={{ color: tokens.color.faint2, flex: "0 0 auto", fontSize: 11, lineHeight: 1, marginRight: 4, opacity: 0.8 }}>↳</span> : null}
          <span style={{ color: active ? tokens.color.violet : "#A39A82", display: "flex", flex: "0 0 auto" }}>
            <KindIcon kind={f.kind} />
          </span>
          <span style={{ fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {f.title || f.id}
          </span>
        </button>
        {canWrite ? (
          <button className="ft-kebab" title="More actions" onClick={(e) => openDocMenu(e, f)}>
            <IconDots size={16} />
          </button>
        ) : null}
      </div>
    );
  };

  const renderNode = (node: CatNode, depth: number): React.ReactNode => {
    // Within a category, nest documents by drill lineage: a doc whose parent is in
    // this same set renders indented under it (recursively).
    const docs = [...node.docs];
    const ids = new Set(docs.map((d) => d.id));
    const childrenOf = (pid: string | null) =>
      docs
        .filter((d) => {
          const par = parents[d.id];
          return pid === null ? !(par && ids.has(par)) : par === pid;
        })
        .sort((a, b) => titleKey(a).localeCompare(titleKey(b)));
    const seen = new Set<string>();
    const forest: React.ReactNode[] = [];
    const walk = (pid: string | null, d: number) => {
      for (const doc of childrenOf(pid)) {
        if (seen.has(doc.id)) continue; // cycle guard
        seen.add(doc.id);
        forest.push(docRow(doc, d));
        walk(doc.id, d + 1);
      }
    };
    walk(null, 0);
    const groups = [...node.children.values()].sort((a, b) => a.name.localeCompare(b.name));
    return (
      <>
        {forest}
        {groups.map((g) => {
          const expanded = !collapsed.has(g.path);
          return (
            <div key={g.path}>
              <div className="ft-catrow">
                <button className="ft-cat" onClick={() => toggleCat(g.path)}>
                  <span className={expanded ? "ft-cat-chev ft-cat-chev-open" : "ft-cat-chev"}>
                    <IconChevronRight size={12} />
                  </span>
                  {g.name}
                </button>
                {canWrite ? (
                  <button className="ft-kebab" title="Category actions" onClick={(e) => openCatMenu(e, g)}>
                    <IconDots size={16} />
                  </button>
                ) : null}
              </div>
              {expanded ? <div style={{ paddingLeft: 12 }}>{renderNode(g, depth + 1)}</div> : null}
            </div>
          );
        })}
      </>
    );
  };

  const sidebarWidth = props.width ?? tokens.size.sidebar;
  return (
    <aside
      style={{
        flex: `0 0 ${sidebarWidth}px`,
        width: sidebarWidth,
        position: "relative",
        display: "flex",
        flexDirection: "column",
        background: tokens.color.sidebar,
        borderRight: `1px solid ${tokens.color.border}`,
      }}
    >
      {props.onResizeStart ? (
        <div
          className="ft-resize"
          onPointerDown={props.onResizeStart}
          title="Drag to resize"
          style={{ position: "absolute", right: -3, top: 0, bottom: 0, width: 7, cursor: "col-resize", zIndex: 5 }}
        />
      ) : null}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 14px 4px 18px" }}>
        <span style={headerLabel}>Documents</span>
        <button className="ft-quiet-soft" style={{ width: 28, height: 28, borderRadius: 7 }} title="Collapse" onClick={onToggle}>
          <IconSidebar />
        </button>
      </div>
      {projectName ? (
        <div style={{ padding: "0 18px 8px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div
              style={{ flex: "1 1 auto", fontSize: 12, color: tokens.color.textSecondary, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
              title={projectName}
            >
              {projectName}
            </div>
            {/* Share — only in serve mode with at least one document. */}
            {canWrite && flows.length > 0 ? (
              <div style={{ position: "relative", flex: "0 0 auto" }}>
                <button
                  className="ft-recent"
                  style={{ height: 24, padding: "0 9px", borderRadius: 7, fontSize: 11.5, fontWeight: 600 }}
                  disabled={building}
                  title="Export / share this project"
                  onClick={() => setShareOpen((v) => !v)}
                >
                  {building ? "Exporting…" : "Share ▾"}
                </button>
                {shareOpen ? (
                  <div style={{ position: "absolute", top: 28, right: 0, zIndex: 20, minWidth: 210, background: "#fff", border: `1px solid ${tokens.color.border}`, borderRadius: 9, boxShadow: "0 6px 20px rgba(74,60,30,.16)", padding: 4 }}>
                    <button className="ft-pop-item" onClick={doExport}>Export self-contained HTML</button>
                    {buildResult ? (
                      <button className="ft-pop-item" onClick={() => { props.onReveal(buildResult.path); setShareOpen(false); }}>Reveal output folder</button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
          {buildErr ? (
            <div style={{ marginTop: 6, fontSize: 11, color: "#8C3B2B" }}>Export failed: {buildErr}</div>
          ) : buildResult ? (
            <div style={{ marginTop: 6, fontSize: 11, color: "#3d7c52", lineHeight: 1.5 }}>
              ✓ Exported {buildResult.files} document(s) → one HTML
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 3 }}>
                <code style={{ flex: "1 1 auto", fontSize: 10, color: tokens.color.faint, fontFamily: tokens.font.mono, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={buildResult.path}>{buildResult.path}</code>
                <button className="ft-recent" style={{ height: 22, padding: "0 7px", borderRadius: 6, fontSize: 10.5, flex: "0 0 auto" }} onClick={() => navigator.clipboard?.writeText(buildResult.path)}>Copy</button>
                <button className="ft-recent" style={{ height: 22, padding: "0 7px", borderRadius: 6, fontSize: 10.5, flex: "0 0 auto" }} onClick={() => props.onReveal(buildResult.path)}>Reveal</button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      <nav style={{ flex: "1 1 auto", padding: "2px 10px 8px", display: "flex", flexDirection: "column", gap: 1, overflowY: "auto" }}>
        {flows.length ? renderNode(root, 0) : <div style={{ padding: "10px 12px", fontSize: 12.5, color: tokens.color.muted }}>No documents.</div>}
      </nav>

      {canWrite ? (
        <div style={{ padding: 10, borderTop: `1px solid ${tokens.color.borderSoft}` }}>
          {/* Connect agent (MCP) — always available (you may wire up several agents) */}
          {mcp ? (
            <div style={{ marginBottom: 10 }}>
              {!mcpOpen ? (
                <button
                  className="ft-newflow"
                  style={{ gap: 8, width: "100%", height: 34, padding: "0 12px", borderRadius: 9, fontSize: 12.5, fontWeight: 550, justifyContent: "center" }}
                  onClick={() => {
                    setMcpOpen(true);
                    setMcpResult(null);
                    setMcpChosen(null);
                    setCustomOpen(false);
                  }}
                  title="Wire up an MCP config so an agent can author here"
                >
                  <IconLink size={14} />
                  Connect agent (MCP)
                </button>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span style={headerLabel}>Connect agent</span>
                    <button className="ft-quiet-soft" style={{ width: 24, height: 24, borderRadius: 6 }} title="Close" onClick={() => { setMcpOpen(false); setMcpChosen(null); setMcpResult(null); }}>
                      <IconClose size={13} />
                    </button>
                  </div>
                  {mcpResult ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {mcpResult.status === "conflict" ? (
                        <div style={{ fontSize: 11.5, color: tokens.color.textSecondary, lineHeight: 1.45 }}>
                          <div style={{ marginBottom: 6, fontFamily: tokens.font.mono, color: tokens.color.faint, overflowWrap: "anywhere" }}>{mcpResult.path}</div>
                          <div style={{ marginBottom: 6 }}>Paste this entry into the config:</div>
                          <pre style={{ background: tokens.color.field, border: `1px solid ${tokens.color.border}`, borderRadius: 7, padding: 8, fontSize: 10.5, fontFamily: tokens.font.mono, overflowX: "auto", margin: 0, whiteSpace: "pre" }}>{mcpResult.snippet}</pre>
                          <button className="ft-recent" style={{ marginTop: 6, justifyContent: "center" }} onClick={() => navigator.clipboard?.writeText(mcpResult.snippet)}>
                            Copy snippet
                          </button>
                        </div>
                      ) : (
                        <div style={{ fontSize: 12, color: "#3d7c52", lineHeight: 1.45 }}>
                          ✓ {mcpResult.status === "already" ? "Already configured" : "Configured"} — restart your agent to load it.
                          <div style={{ fontSize: 10.5, color: tokens.color.faint, fontFamily: tokens.font.mono, marginTop: 3, overflowWrap: "anywhere" }}>{mcpResult.path}</div>
                        </div>
                      )}
                      <button className="ft-quiet-soft" style={{ height: 26, borderRadius: 7, fontSize: 12, color: tokens.color.textSecondary }} onClick={() => { setMcpResult(null); setMcpChosen(null); }}>
                        ← Back
                      </button>
                    </div>
                  ) : mcpChosen ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      <div style={{ fontSize: 12, color: tokens.color.text, fontWeight: 600 }}>
                        {mcpChosen.label}
                        <div style={{ fontSize: 10.5, color: tokens.color.faint, fontFamily: tokens.font.mono, marginTop: 3, fontWeight: 400, overflowWrap: "anywhere" }}>{mcpChosen.location}</div>
                      </div>
                      {mcpChosen.guiManaged ? (
                        <div style={{ fontSize: 11, lineHeight: 1.5, color: "#8a5a1c", background: "#FBF1DF", border: "1px solid #E8D097", borderRadius: 8, padding: "7px 9px" }}>
                          ⚠️ <b>Quit {mcpChosen.label} completely first</b> — it rewrites its own config when it
                          exits, so a change added while it is running gets discarded. Close it from the tray/
                          background (not just the window), then add. Or add {BRAND.display} via {mcpChosen.label}'s
                          own MCP settings.
                        </div>
                      ) : null}
                      <button className="ft-primary" style={{ borderRadius: 8, height: 34, fontSize: 13, justifyContent: "center" }} disabled={mcpBusy} onClick={() => doSetupMcp(mcpChosen.location, mcpChosen.schema, false)}>
                        Add to config
                      </button>
                      <button className="ft-recent" style={{ justifyContent: "center" }} disabled={mcpBusy} onClick={() => doSetupMcp(mcpChosen.location, mcpChosen.schema, true)}>
                        Copy snippet instead
                      </button>
                      <button className="ft-quiet-soft" style={{ height: 26, borderRadius: 7, fontSize: 12, color: tokens.color.textSecondary }} onClick={() => setMcpChosen(null)}>
                        ← Back
                      </button>
                    </div>
                  ) : (
                    <>
                      {(() => {
                        const detected = mcp.agents.filter((a) => a.present && !a.configured);
                        const others = mcp.agents.filter((a) => !a.present && !a.configured);
                        const configured = mcp.agents.filter((a) => a.configured);
                        const row = (a: McpStatus["agents"][number]) => (
                          <button key={a.id} className="ft-recent" title={a.location} onClick={() => setMcpChosen({ label: a.label, location: a.location, schema: a.schema, guiManaged: a.guiManaged })}>
                            <span style={{ color: a.present ? tokens.color.violet : "#A39A82", display: "flex", flex: "0 0 auto" }}>
                              <IconLink size={13} />
                            </span>
                            <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                              <span style={{ fontWeight: 600 }}>{a.label}</span>
                              <span style={{ fontSize: 10, color: tokens.color.faint, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.location}</span>
                            </span>
                          </button>
                        );
                        return (
                          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                            {detected.length ? <div className="ft-pop-label" style={{ padding: "2px 4px" }}>Detected here</div> : null}
                            {detected.map(row)}
                            {others.length ? <div className="ft-pop-label" style={{ padding: "6px 4px 2px" }}>Other agents</div> : null}
                            {others.map(row)}
                            {configured.length ? (
                              <div style={{ fontSize: 11, color: "#3d7c52", padding: "8px 4px 0", lineHeight: 1.5 }}>
                                ✓ Connected: {configured.map((a) => a.label).join(", ")}
                              </div>
                            ) : null}
                          </div>
                        );
                      })()}
                      {customOpen ? (
                        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 2 }}>
                          <input className="ft-field" placeholder="Config file path…" value={customLoc} onChange={(e) => setCustomLoc(e.target.value)} />
                          <div style={{ display: "flex", gap: 6 }}>
                            {(["json", "toml"] as const).map((f) => (
                              <button
                                key={f}
                                onClick={() => setCustomFmt(f)}
                                style={{
                                  flex: 1,
                                  height: 28,
                                  borderRadius: 7,
                                  border: `1px solid ${customFmt === f ? tokens.color.violet : tokens.color.border}`,
                                  background: customFmt === f ? tokens.color.violetBg : "transparent",
                                  color: customFmt === f ? tokens.color.violet : tokens.color.textSecondary,
                                  cursor: "pointer",
                                  fontFamily: "inherit",
                                  fontSize: 12,
                                  fontWeight: 600,
                                }}
                              >
                                {f.toUpperCase()}
                              </button>
                            ))}
                          </div>
                          {customFmt === "json" ? (
                            <select className="ft-field" value={customKey} onChange={(e) => setCustomKey(e.target.value)}>
                              <option value="mcpServers">mcpServers (Claude Code, Cursor, …)</option>
                              <option value="servers">servers (VS Code)</option>
                              <option value="context_servers">context_servers (Zed)</option>
                            </select>
                          ) : null}
                          <button
                            className="ft-primary"
                            style={{ borderRadius: 7, padding: "0 14px", fontSize: 12.5, height: 30 }}
                            disabled={!customLoc.trim()}
                            onClick={() => setMcpChosen({ label: "Custom", location: customLoc.trim(), schema: { format: customFmt, key: customFmt === "toml" ? "mcp_servers" : customKey } })}
                          >
                            Continue
                          </button>
                        </div>
                      ) : (
                        <button className="ft-recent" style={{ justifyContent: "center", color: tokens.color.textSecondary }} onClick={() => setCustomOpen(true)}>
                          Custom location…
                        </button>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          ) : null}
          {opOpen ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={headerLabel}>Open project</span>
                <button className="ft-quiet-soft" style={{ width: 24, height: 24, borderRadius: 6 }} title="Close" onClick={() => setOpOpen(false)}>
                  <IconClose size={13} />
                </button>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <input
                  className="ft-field"
                  autoFocus
                  placeholder="Path to project folder…"
                  value={opPath}
                  onChange={(e) => setOpPath(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && opPath.trim()) {
                      props.onOpenProject(opPath.trim());
                      setOpOpen(false);
                      setOpPath("");
                    } else if (e.key === "Escape") setOpOpen(false);
                  }}
                />
                <button
                  className="ft-quiet"
                  title="Browse folders"
                  style={{ flex: "0 0 auto", width: 32, height: 32, borderRadius: 8, border: `1px solid ${navListing ? tokens.color.violet : tokens.color.border}` }}
                  onClick={() => (navListing ? setNavListing(null) : loadDir())}
                >
                  <IconFolder size={15} />
                </button>
              </div>
              {navListing ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                  <div style={{ fontSize: 10.5, fontFamily: tokens.font.mono, color: tokens.color.faint, overflowWrap: "anywhere" }}>{navListing.path}</div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button
                      className="ft-recent"
                      style={{ flex: 1, justifyContent: "center" }}
                      disabled={!navListing.parent || navBusy}
                      onClick={() => navListing.parent && loadDir(navListing.parent)}
                    >
                      ⬆ Up
                    </button>
                    <button
                      className="ft-primary"
                      style={{ borderRadius: 7, padding: "0 12px", fontSize: 12.5, height: 32 }}
                      disabled={navBusy}
                      onClick={() => {
                        props.onOpenProject(navListing.path);
                        setOpOpen(false);
                        setNavListing(null);
                      }}
                    >
                      Open this folder
                    </button>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 1, maxHeight: 180, overflowY: "auto" }}>
                    {navListing.dirs.length ? (
                      navListing.dirs.map((d) => (
                        <button key={d} className="ft-recent" disabled={navBusy} title={d} onClick={() => loadDir(`${navListing.path}/${d}`)}>
                          <span style={{ color: "#A39A82", display: "flex", flex: "0 0 auto" }}>
                            <IconFolder size={14} />
                          </span>
                          <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{d}</span>
                        </button>
                      ))
                    ) : (
                      <div style={{ fontSize: 11.5, color: tokens.color.faint, padding: "4px 8px" }}>No subfolders here.</div>
                    )}
                  </div>
                </div>
              ) : recents.length ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 1, maxHeight: 160, overflowY: "auto" }}>
                  <div className="ft-pop-label" style={{ padding: "2px 4px 2px" }}>
                    Recent
                  </div>
                  {recents.map((r) => (
                    <button
                      key={r}
                      className="ft-recent"
                      title={r}
                      onClick={() => {
                        props.onOpenProject(r);
                        setOpOpen(false);
                        setOpPath("");
                      }}
                    >
                      <span style={{ color: "#A39A82", display: "flex", flex: "0 0 auto" }}>
                        <IconFolder size={14} />
                      </span>
                      <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : (
            <button
              className="ft-newflow"
              style={{ gap: 8, width: "100%", height: 36, padding: "0 12px", borderRadius: 9, fontSize: 13, fontWeight: 550, justifyContent: "center" }}
              onClick={() => setOpOpen(true)}
            >
              <IconFolder size={15} />
              Open project
            </button>
          )}
        </div>
      ) : null}

      {/* Context menu / inline editors (anchored to the kebab) */}
      {pop ? (
        <>
          <div className="ft-backdrop" onClick={() => setPop(null)} />
          <div className="ft-pop" style={{ top: pop.top, right: pop.right }}>
            {pop.mode === "menu" && pop.kind === "doc" ? (
              <>
                <button className="ft-pop-item" onClick={() => { onSelectFlow(pop.f.id); setPop(null); }}>
                  <span style={{ color: tokens.color.muted, display: "flex" }}>
                    <KindIcon kind={pop.f.kind} size={15} />
                  </span>
                  Open
                </button>
                <button className="ft-pop-item" onClick={() => toMode("rename")}>
                  <span style={{ color: tokens.color.muted, display: "flex" }}>
                    <IconPencil size={15} />
                  </span>
                  Rename…
                </button>
                <button className="ft-pop-item" onClick={() => toMode("category")}>
                  <span style={{ color: tokens.color.muted, display: "flex" }}>
                    <IconTag size={15} />
                  </span>
                  Set category…
                </button>
                <button className="ft-pop-item danger" onClick={() => toMode("delete")}>
                  <span style={{ display: "flex" }}>
                    <IconTrash size={15} />
                  </span>
                  Delete
                </button>
              </>
            ) : pop.mode === "menu" && pop.kind === "cat" ? (
              <button className="ft-pop-item" onClick={() => toMode("rename")}>
                <span style={{ color: tokens.color.muted, display: "flex" }}>
                  <IconPencil size={15} />
                </span>
                Rename category…
              </button>
            ) : pop.kind === "doc" && pop.mode === "delete" ? (
              <div style={{ padding: "4px 6px 6px", display: "flex", flexDirection: "column", gap: 10, minWidth: 200 }}>
                <div style={{ fontSize: 12.5, color: tokens.color.text, lineHeight: 1.4 }}>
                  Delete <strong>{pop.f.title || pop.f.id}</strong>? This removes the file from disk.
                </div>
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                  <button className="ft-pop-item" style={{ width: "auto", padding: "6px 12px" }} onClick={() => setPop(null)}>
                    Cancel
                  </button>
                  <button
                    className="ft-primary"
                    style={{ borderRadius: 8, padding: "6px 14px", fontSize: 13, background: "#A23B29" }}
                    onClick={() => { props.onDelete(pop.f.id); setPop(null); }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ padding: "2px 4px 4px", display: "flex", flexDirection: "column", gap: 8, minWidth: 220 }}>
                <div className="ft-pop-label">
                  {pop.kind === "cat" ? "Rename category" : pop.mode === "rename" ? "Rename document" : "Set category"}
                </div>
                <input
                  className="ft-field"
                  autoFocus
                  placeholder={
                    pop.kind === "cat"
                      ? "Category name…"
                      : pop.mode === "rename"
                        ? "Title…"
                        : "Category (a/b) — empty to ungroup"
                  }
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commit();
                    else if (e.key === "Escape") setPop(null);
                  }}
                />
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                  <button className="ft-pop-item" style={{ width: "auto", padding: "6px 12px" }} onClick={() => setPop(null)}>
                    Cancel
                  </button>
                  <button className="ft-primary" style={{ borderRadius: 8, padding: "6px 14px", fontSize: 13 }} onClick={commit}>
                    Save
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      ) : null}
    </aside>
  );
}
