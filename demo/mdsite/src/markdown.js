// A tiny Markdown subset renderer (headings, paragraphs, lists, links, bold, code).
// Intentionally hand-written (no deps) so the per-token render loop and the reused
// escapeHtml / resolveLink helpers are our own code with real source refs.

import { escapeHtml, resolveLink } from "./html.js";

/** Split Markdown into block tokens (heading | list | paragraph). */
export function tokenize(md) {
  const tokens = [];
  const lines = md.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (h) {
      tokens.push({ type: "heading", level: h[1].length, text: h[2] });
      i++;
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^[-*]\s+/, ""));
        i++;
      }
      tokens.push({ type: "list", items });
      continue;
    }
    const buf = [];
    while (i < lines.length && lines[i].trim()) {
      buf.push(lines[i]);
      i++;
    }
    tokens.push({ type: "paragraph", text: buf.join(" ") });
  }
  return tokens;
}

/** Render a single block token to HTML — called once per token in renderMarkdown. */
export function renderToken(token, baseUrl) {
  switch (token.type) {
    case "heading":
      return `<h${token.level}>${renderInline(token.text, baseUrl)}</h${token.level}>`;
    case "list":
      return `<ul>${token.items.map((it) => `<li>${renderInline(it, baseUrl)}</li>`).join("")}</ul>`;
    case "paragraph":
      return `<p>${renderInline(token.text, baseUrl)}</p>`;
    default:
      return "";
  }
}

/** Inline rendering: resolve + escape links, then escape/format the rest. */
export function renderInline(text, baseUrl) {
  let out = "";
  let rest = text;
  const linkRe = /\[([^\]]+)\]\(([^)]+)\)/;
  let m;
  while ((m = rest.match(linkRe))) {
    out += formatSegment(rest.slice(0, m.index));
    const href = resolveLink(m[2], baseUrl);
    out += `<a href="${escapeHtml(href)}">${formatSegment(m[1])}</a>`;
    rest = rest.slice(m.index + m[0].length);
  }
  out += formatSegment(rest);
  return out;
}

/** Escape a plain segment, then apply **bold** and `code`. */
function formatSegment(seg) {
  return escapeHtml(seg)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

/** Tokenize then render every block — the showcase per-token loop. */
export function renderMarkdown(md, baseUrl) {
  const tokens = tokenize(md);
  return tokens.map((t) => renderToken(t, baseUrl)).join("\n");
}
