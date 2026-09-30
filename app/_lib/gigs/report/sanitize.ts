import { parseHTML } from "linkedom";

// The allow-list sanitizer for a model-written report section (gig_report_cli.py writes each
// section's body as HTML in a small vocabulary the report's stylesheet styles). The model read
// strangers' text - the listing, pages it links to, an agent's draft - so its HTML is treated
// as hostile: it is PARSED (linkedom, already a dependency for the job-seeker rules engine)
// and a new document is SERIALIZED from the tree, keeping only what the vocabulary names.
// Nothing the model wrote reaches the file as markup unless it passed through `emit` below.
//
//   kept elements   p h3 ul ol li strong em code blockquote br mark
//                   table thead tbody tr th td figure figcaption
//                   div   only as .stat-cards, .stat, .callout (+ .warn | .ok)
//                   span  only as .n, .l, .c (a stat card's parts) or .pill (+ .ok | .fail | .wait)
//                   a     only with an https href (no credentials); rel is set by kp
//   renamed         h1 h2 h4 h5 h6 -> h3 (the template owns h1/h2), b -> strong, i -> em
//   dropped WITH their content   script style iframe object embed svg math img video audio
//                   canvas form input button select textarea template noscript head title ...
//   unwrapped       every other element (its text and allowed children are kept)
//   attributes      class (filtered to the element's allowed set), colspan/rowspan (1..20)
//                   on th/td, href on a; every other attribute is dropped - on*, style, id,
//                   src, srcset, data-*, xlink:href included
//   text            re-escaped (& < > " ') whatever entities the model used
//
// Every table is wrapped in kp's own `div.tbl` (horizontal scroll on a narrow screen); the
// class is not in the model's vocabulary, so only this module can write it. Nesting deeper
// than MAX_DEPTH is flattened to text. Pure apart from the parser.

const MAX_DEPTH = 24;

const KEEP = new Set([
  "p",
  "h3",
  "ul",
  "ol",
  "li",
  "strong",
  "em",
  "code",
  "blockquote",
  "br",
  "mark",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "figure",
  "figcaption",
  "div",
  "span",
  "a",
]);

const RENAME: Readonly<Record<string, string>> = { h1: "h3", h2: "h3", h4: "h3", h5: "h3", h6: "h3", b: "strong", i: "em" };

const DROP = new Set([
  "script",
  "style",
  "iframe",
  "frame",
  "frameset",
  "object",
  "embed",
  "applet",
  "svg",
  "math",
  "img",
  "picture",
  "source",
  "video",
  "audio",
  "track",
  "canvas",
  "form",
  "input",
  "button",
  "select",
  "option",
  "textarea",
  "template",
  "noscript",
  "head",
  "title",
  "meta",
  "link",
  "base",
  "dialog",
  "portal",
]);

/** The base classes an element may carry, and the modifiers each base admits. */
const DIV_BASES: Readonly<Record<string, readonly string[]>> = { "stat-cards": [], stat: [], callout: ["warn", "ok"] };
const SPAN_BASES: Readonly<Record<string, readonly string[]>> = { n: [], l: [], c: [], pill: ["ok", "fail", "wait"] };

/** The class list kp keeps on a div/span: ONE base from the table and the modifiers that
 *  base admits, in that order. Null when no base class is present (the element is unwrapped). */
export function allowedClass(tag: "div" | "span", raw: string | null): string | null {
  const tokens = (raw ?? "").split(/\s+/).filter(Boolean);
  const bases = tag === "div" ? DIV_BASES : SPAN_BASES;
  const base = tokens.find((t) => Object.prototype.hasOwnProperty.call(bases, t));
  if (!base) return null;
  const mods = bases[base].filter((m) => tokens.includes(m));
  return [base, ...mods].join(" ");
}

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;"));
}

/** An https URL with no credentials, normalized; null for anything else (javascript:,
 *  data:, http:, a relative path, a protocol-relative //host). */
export function safeHttpsHref(raw: string | null): string | null {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    // not an absolute URL: a relative or malformed href is never kept
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || !url.hostname) return null;
  return url.href;
}

function span(raw: string | null): number | null {
  if (!raw || !/^\d{1,2}$/.test(raw.trim())) return null;
  const n = Number(raw.trim());
  return n >= 1 && n <= 20 ? n : null;
}

type DomNode = {
  nodeType: number;
  localName?: string;
  tagName?: string;
  nodeValue?: string | null;
  textContent?: string | null;
  childNodes: ArrayLike<DomNode>;
  getAttribute?: (name: string) => string | null;
};

function children(node: DomNode, depth: number): string {
  let out = "";
  for (let i = 0; i < node.childNodes.length; i++) out += emit(node.childNodes[i], depth);
  return out;
}

function emit(node: DomNode, depth: number): string {
  if (node.nodeType === 3) return escapeHtml(node.nodeValue ?? "");
  if (node.nodeType !== 1) return ""; // comments, processing instructions, doctypes
  const name = String(node.localName ?? node.tagName ?? "").toLowerCase();
  if (DROP.has(name)) return "";
  if (depth >= MAX_DEPTH) return escapeHtml(node.textContent ?? "");
  const tag = RENAME[name] ?? name;
  if (!KEEP.has(tag)) return children(node, depth + 1);
  const attr = (n: string) => (node.getAttribute ? node.getAttribute(n) : null);
  let attrs = "";
  if (tag === "div" || tag === "span") {
    const cls = allowedClass(tag, attr("class"));
    if (!cls) return children(node, depth + 1);
    attrs = ` class="${cls}"`;
  } else if (tag === "a") {
    const href = safeHttpsHref(attr("href"));
    if (!href) return children(node, depth + 1);
    attrs = ` href="${escapeHtml(href)}" rel="noopener noreferrer nofollow"`;
  } else if (tag === "th" || tag === "td") {
    const colspan = span(attr("colspan"));
    const rowspan = span(attr("rowspan"));
    if (colspan && colspan > 1) attrs += ` colspan="${colspan}"`;
    if (rowspan && rowspan > 1) attrs += ` rowspan="${rowspan}"`;
  }
  if (tag === "br") return "<br>";
  const inner = children(node, depth + 1);
  const el = `<${tag}${attrs}>${inner}</${tag}>`;
  return tag === "table" ? `<div class="tbl">${el}</div>` : el;
}

/** The model's section HTML, re-serialized through the allow-list above. Never throws: a
 *  document the parser cannot read at all answers the text alone, escaped. */
export function sanitizeReportHtml(html: string): string {
  if (!html.trim()) return "";
  try {
    // A stray </body> or </html> in the model's text would end the parse early and lose
    // everything after it; the document tags are never part of a section anyway.
    const fragment = html.replace(/<\/?(?:html|body|head)\b[^>]*>/gi, "");
    const { document } = parseHTML(`<!doctype html><html><head></head><body>${fragment}</body></html>`);
    const body = document.body as unknown as DomNode | null;
    if (!body) return escapeHtml(html);
    return children(body, 0).trim();
  } catch {
    // a parser failure on hostile input: fall back to the whole text, escaped - never markup
    return `<p>${escapeHtml(html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim())}</p>`;
  }
}
