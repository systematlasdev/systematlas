// Shared HTML helpers. These two functions are the "hot" utilities — called from
// several places during a build, which is exactly what makes them show up as
// reused (×N) calls in the SystemAtlas Sequence diagram.

const ENTITIES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** Escape text for safe HTML output. Called from inline rendering AND the layout. */
export function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ENTITIES[c]);
}

/** Turn a Markdown link target into a final URL: leave absolute/anchor links as-is,
 *  otherwise make it root-relative under baseUrl and rewrite .md → .html.
 *  Called from inline rendering AND from sitemap generation. */
export function resolveLink(href, baseUrl) {
  if (/^https?:\/\//.test(href) || href.startsWith("#") || href.startsWith("mailto:")) return href;
  const base = baseUrl.endsWith("/") ? baseUrl : baseUrl + "/";
  const clean = href.replace(/^\.?\//, "").replace(/\.md$/, ".html");
  return base + clean;
}
