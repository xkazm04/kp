// Validation for an UPLOADED logo (PNG or SVG), pure and dependency-free.
//
// The stored bytes are served back from a PUBLIC door (GET /api/brand/logo — the
// candidate pages have no session), so what is accepted here is what the browser will
// be handed under our origin. PNG is decided by its magic bytes, never by the client's
// Content-Type. An SVG is the dangerous one: it is a document that can carry script,
// a foreign HTML island, event handlers and external fetches. There is no XML parser
// in the dependency set, so instead of a deny-list over a parser's output this is an
// ALLOW-list over a strict tokenizer: every element must be a known drawing element,
// every `href` must be a same-document `#fragment`, and anything the tokenizer cannot
// account for (DOCTYPE/entities, CDATA, unquoted attributes, stray `<`) is refused.
// The serving door adds a sandboxing CSP on top; this is the first of the two layers.

/** Largest stored logo, measured on the bytes READ. A logo is a few KB; 512 KB is
 *  generous and keeps one row from bloating the shared SQLite file. */
export const MAX_LOGO_BYTES = 512 * 1024;

/** The one URL the stored bytes are served from. */
export const LOGO_PATH = "/api/brand/logo";

export type LogoMime = "image/png" | "image/svg+xml";

export type LogoRefusal = "BRAND_LOGO_EMPTY" | "BRAND_LOGO_TOO_LARGE" | "BRAND_LOGO_TYPE" | "BRAND_LOGO_UNSAFE";

export type LogoVerdict = { ok: true; mime: LogoMime } | { ok: false; code: LogoRefusal };

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Drawing elements only (lowercased). No script, foreignObject, a, image, animate*,
 *  set, iframe, object, embed — anything absent from this set is refused. */
const SAFE_ELEMENTS: ReadonlySet<string> = new Set([
  "svg", "g", "defs", "symbol", "use", "title", "desc", "metadata",
  "path", "rect", "circle", "ellipse", "line", "polyline", "polygon",
  "text", "tspan", "textpath",
  "lineargradient", "radialgradient", "stop", "pattern", "clippath", "mask", "marker", "style",
  "filter", "feblend", "fecolormatrix", "fecomponenttransfer", "fecomposite", "feconvolvematrix",
  "fediffuselighting", "fedisplacementmap", "fedropshadow", "feflood", "fefunca", "fefuncb",
  "fefuncg", "fefuncr", "fegaussianblur", "femerge", "femergenode", "femorphology", "feoffset",
  "fespecularlighting", "fetile", "feturbulence", "fedistantlight", "fepointlight", "fespotlight",
]);

const NAMED_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

/** Decode the five XML entities and numeric references; null on any other entity
 *  (DOCTYPE is refused, so a custom entity can never be defined, only referenced). */
function decodeEntities(s: string): string | null {
  let bad = false;
  const out = s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z]+);/g, (_m, ref: string) => {
    if (ref[0] === "#") {
      const cp = ref[1] === "x" ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      if (!Number.isFinite(cp) || cp > 0x10ffff) {
        bad = true;
        return "";
      }
      return String.fromCodePoint(cp);
    }
    const v = NAMED_ENTITIES[ref];
    if (v === undefined) {
      bad = true;
      return "";
    }
    return v;
  });
  return bad ? null : out;
}

/** CSS that imports, runs script-ish values, or fetches anything but a `#fragment`.
 *  Any backslash is refused outright: a CSS escape (`u\72l(`, `@\69mport`) spells a
 *  fetch the checks below cannot see, and a logo has no use for one. */
function cssUnsafe(css: string): boolean {
  if (css.includes("\\")) return true;
  const c = css.replace(/\/\*[\s\S]*?\*\//g, "");
  if (/@import|expression\s*\(|javascript:|behavior\s*:|-moz-binding/i.test(c)) return true;
  for (const m of c.matchAll(/url\s*\(\s*(['"]?)\s*([^)'"]*)/gi)) {
    if (!m[2].startsWith("#")) return true;
  }
  return false;
}

function svgUnsafe(text: string): boolean {
  let src = text.replace(/^﻿/, "");
  // The xml DECLARATION only: `<?xml` must end the target name, or `<?xml-stylesheet ...?>`
  // (an XSLT/CSS processing instruction that fetches) would be stripped unseen as one.
  src = src.replace(/^\s*<\?xml(?:\s[^>]*)?\?>/, "");
  // Comments carry no semantics; strip them (a `<` inside one is not markup).
  src = src.replace(/<!--[\s\S]*?-->/g, "");
  const TAG = /<(\/)?([A-Za-z_][\w.-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/)?>/g;
  const stack: string[] = [];
  let rootClosed = false;
  let seenRoot = false;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = TAG.exec(src))) {
    const gap = src.slice(last, m.index);
    last = TAG.lastIndex;
    if (gap.includes("<")) return true;
    if (stack[stack.length - 1] === "style") {
      if (cssUnsafe(decodeEntities(gap) ?? "@import")) return true;
    } else if (gap.trim() !== "" && stack.length === 0) {
      return true; // text outside the root
    }
    const [, closing, rawName, attrText, selfClose] = m;
    const name = rawName.toLowerCase();
    if (!SAFE_ELEMENTS.has(name)) return true;
    if (closing) {
      if (attrText.trim() !== "" || selfClose) return true;
      if (stack.pop() !== name) return true;
      if (stack.length === 0) rootClosed = true;
      continue;
    }
    if (rootClosed) return true; // a second root
    if (!seenRoot) {
      if (name !== "svg") return true;
      seenRoot = true;
    }
    // Attributes: name="value" only. Anything the loop cannot consume is malformed.
    let rest = attrText.trim();
    while (rest) {
      const a = /^([A-Za-z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')\s*/.exec(rest);
      if (!a) return true;
      rest = rest.slice(a[0].length);
      const attr = a[1].toLowerCase();
      const value = decodeEntities(a[2] ?? a[3] ?? "");
      if (value === null) return true;
      if (attr.startsWith("on") || attr === "src") return true;
      if (attr === "href" || attr.endsWith(":href")) {
        if (!value.trim().startsWith("#")) return true;
      } else if (/javascript:|vbscript:|data:text\/html/i.test(value)) {
        return true;
      }
      // style, and any value a CSS parser could read as a function or an escape (a
      // presentation attribute like fill= is parsed as CSS, escapes included).
      if ((attr === "style" || /[(\\]/.test(value)) && cssUnsafe(value)) return true;
    }
    if (!selfClose) stack.push(name);
    else if (stack.length === 0) rootClosed = true;
  }
  const tail = src.slice(last);
  if (tail.includes("<") || tail.trim() !== "") return true;
  return !seenRoot || stack.length !== 0 || !rootClosed;
}

/** Decide whether `bytes` may be stored as the workspace logo, and as which type. */
export function validateLogoUpload(bytes: Uint8Array): LogoVerdict {
  if (bytes.byteLength === 0) return { ok: false, code: "BRAND_LOGO_EMPTY" };
  if (bytes.byteLength > MAX_LOGO_BYTES) return { ok: false, code: "BRAND_LOGO_TOO_LARGE" };
  if (PNG_MAGIC.every((b, i) => bytes[i] === b)) return { ok: true, mime: "image/png" };
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return { ok: false, code: "BRAND_LOGO_TYPE" };
  }
  // Not even shaped like markup: a wrong type, not a hostile one.
  if (!/^\s*<(?:\?xml|svg|!--|!doctype)/i.test(text)) return { ok: false, code: "BRAND_LOGO_TYPE" };
  return svgUnsafe(text) ? { ok: false, code: "BRAND_LOGO_UNSAFE" } : { ok: true, mime: "image/svg+xml" };
}
