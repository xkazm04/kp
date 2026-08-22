// Markdown ⇄ HTML for the RichTextEditor (WYSIWYG). Both directions are pure
// string→string so they unit-test in node without a DOM, and so the editor can
// seed its contentEditable (markdownToHtml) and read it back (htmlToMarkdown on
// the element's innerHTML) with a stable round-trip.
//
// Supported subset — matches app/_components/Markdown.tsx (the renderer) plus
// <u> underline: # / ## / ### headings, - / * bullets, 1. ordered lists,
// blank-line paragraphs, and inline **bold**, *italic*, `code`, `[text](url)`
// links, <u>underline</u>, and backslash escapes (`\*` prints a literal `*`).
// Template {{placeholders}} carry no markdown meaning, so they pass through as
// plain text untouched. The HTML side also tolerates the tags Chromium's
// contentEditable emits (a, b/strong, i/em, u, div, br, span) so an edit round-trips.

const VOID_TAGS = new Set(["br", "hr", "img", "input"]);
const BLOCK_TAGS = new Set(["p", "div", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "blockquote"]);

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#3?9;/g, "'")
    .replace(/&amp;/g, "&");
}

// A link href is emitted (or rendered) only when its scheme is safe — http(s) or
// mailto. Anything else (javascript:, data:, vbscript:, …) returns null so the
// caller renders the link as inert literal text, never an executable href. Shared
// with Markdown.tsx so the renderer and the round-trip agree on what a link is.
export function safeLinkHref(url: string): string | null {
  const href = url.trim();
  return /^(https?:\/\/|mailto:)/i.test(href) ? href : null;
}

// A contentEditable text node is LITERAL text, but `*` `` ` `` and a `<u>`-looking
// run are STRUCTURAL in markdown — emitted verbatim they corrupt the public render
// (a typed "use *args" would italicize; a stray `<u>…</u>` would underline). Escape
// backslash first (so we don't double-escape), then the active characters, so the
// renderer's escape-aware inline pass prints them literally and the round-trip is
// lossless. Brackets are intentionally NOT escaped — a typed `[x](https://y)` is a
// real link, and a non-URL scheme is rejected by safeLinkHref anyway.
function escapeMarkdownText(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/([*`])/g, "\\$1")
    .replace(/<(\/?u>)/gi, "\\<$1");
}

// A paragraph line that LITERALLY starts with a block marker (`# ` heading, `- `
// bullet, `1. ` ordered) would be re-read by the renderer as that structure. Only
// at the start of a line is the marker structural, so escape it there (per line, so
// a <br>-joined run is covered). `*` bullets need no handling — escapeMarkdownText
// already escaped the `*`. The renderer's inline pass unescapes `\#`/`\-`/`\.`.
function escapeLeadingMarker(block: string): string {
  return block
    .split("\n")
    .map((line) => line.replace(/^(\s*)(#{1,3}\s|-\s)/, "$1\\$2").replace(/^(\s*\d+)(\.\s)/, "$1\\$2"))
    .join("\n");
}

// ── Markdown → HTML ─────────────────────────────────────────────────────────

// Inline: a `\`-escape wins first (so `\*` is a literal `*`), then `[text](url)`,
// then the FIRST of **bold**, *italic*, `code`, <u>…</u> left-to-right (bold
// before italic so `**` beats `*`); bold/italic/underline/link text recurse so
// nested emphasis renders, code is literal. Everything else is HTML-escaped so
// setting innerHTML with the result is safe.
// Groups: 1 escaped char · 2 link text · 3 link url · 4 bold · 5 italic · 6 code · 7 underline.
function inlineToHtml(text: string): string {
  const re = /\\([\\*`<#.-])|\[([^\]]+)\]\(([^)]+)\)|\*\*([\s\S]+?)\*\*|\*([\s\S]+?)\*|`([^`]+)`|<u>([\s\S]*?)<\/u>/;
  let out = "";
  let rest = text;
  while (rest.length) {
    const m = re.exec(rest);
    if (!m) {
      out += escapeHtml(rest);
      break;
    }
    if (m.index > 0) out += escapeHtml(rest.slice(0, m.index));
    if (m[1] !== undefined) out += escapeHtml(m[1]);
    else if (m[2] !== undefined) {
      const href = safeLinkHref(m[3]);
      out += href
        ? `<a href="${escapeHtml(href).replace(/"/g, "&quot;")}" target="_blank" rel="noopener noreferrer">${inlineToHtml(m[2])}</a>`
        : escapeHtml(m[0]);
    } else if (m[4] !== undefined) out += `<strong>${inlineToHtml(m[4])}</strong>`;
    else if (m[5] !== undefined) out += `<em>${inlineToHtml(m[5])}</em>`;
    else if (m[6] !== undefined) out += `<code>${escapeHtml(m[6])}</code>`;
    else out += `<u>${inlineToHtml(m[7])}</u>`;
    rest = rest.slice(m.index + m[0].length);
  }
  return out;
}

export function markdownToHtml(md: string): string {
  const lines = (md ?? "").replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const t = lines[i].trim();
    if (t === "") {
      i += 1;
      continue;
    }
    const h = /^(#{1,3})\s+(.*)$/.exec(t);
    if (h) {
      out.push(`<h${h[1].length}>${inlineToHtml(h[2])}</h${h[1].length}>`);
      i += 1;
      continue;
    }
    if (/^[-*]\s+/.test(t)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
        items.push(inlineToHtml(lines[i].trim().replace(/^[-*]\s+/, "")));
        i += 1;
      }
      out.push(`<ul>${items.map((x) => `<li>${x}</li>`).join("")}</ul>`);
      continue;
    }
    if (/^\d+\.\s+/.test(t)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        items.push(inlineToHtml(lines[i].trim().replace(/^\d+\.\s+/, "")));
        i += 1;
      }
      out.push(`<ol>${items.map((x) => `<li>${x}</li>`).join("")}</ol>`);
      continue;
    }
    // Paragraph — join consecutive plain lines (matches Markdown.tsx), so a soft
    // line break collapses to a space rather than a stray empty block.
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !/^(#{1,3})\s+/.test(lines[i].trim()) &&
      !/^[-*]\s+/.test(lines[i].trim()) &&
      !/^\d+\.\s+/.test(lines[i].trim())
    ) {
      para.push(lines[i].trim());
      i += 1;
    }
    out.push(`<p>${inlineToHtml(para.join(" "))}</p>`);
  }
  return out.join("");
}

// ── HTML → Markdown ─────────────────────────────────────────────────────────

type HNode = { type: "text"; value: string } | { type: "el"; tag: string; href?: string; children: HNode[] };

// A minimal, forgiving HTML tokenizer → tree. Handles exactly the tags this editor
// produces or Chromium's contentEditable emits; attributes are ignored, mismatched
// close tags pop to the nearest match. Not a general HTML parser — deliberately.
function parseHtml(html: string): HNode[] {
  const root: Extract<HNode, { type: "el" }> = { type: "el", tag: "#root", children: [] };
  const stack: Extract<HNode, { type: "el" }>[] = [root];
  const push = (n: HNode) => stack[stack.length - 1].children.push(n);
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b[^>]*?(\/?)>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    if (m.index > last) {
      const raw = html.slice(last, m.index);
      if (raw) push({ type: "text", value: decodeEntities(raw) });
    }
    const tag = m[2].toLowerCase();
    if (m[1] === "/") {
      for (let k = stack.length - 1; k >= 1; k--) {
        if (stack[k].tag === tag) {
          stack.length = k;
          break;
        }
      }
    } else {
      const el: Extract<HNode, { type: "el" }> = { type: "el", tag, children: [] };
      // Attributes are otherwise ignored, but an <a>'s href must survive so a link
      // round-trips (markdownToHtml emits <a href>, htmlToMarkdown must read it back).
      if (tag === "a") {
        const hrefMatch = /\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(m[0]);
        if (hrefMatch) el.href = decodeEntities(hrefMatch[2] ?? hrefMatch[3] ?? hrefMatch[4] ?? "");
      }
      push(el);
      if (!(m[3] === "/" || VOID_TAGS.has(tag))) stack.push(el);
    }
    last = re.lastIndex;
  }
  if (last < html.length) {
    const raw = html.slice(last);
    if (raw) push({ type: "text", value: decodeEntities(raw) });
  }
  return root.children;
}

function serializeInline(nodes: HNode[]): string {
  let out = "";
  for (const n of nodes) {
    if (n.type === "text") {
      // Escape markdown-active characters so literal `*`/`` ` ``/`<u>` typed into the
      // editor can't be re-parsed as structure by the renderer (state-corruption).
      out += escapeMarkdownText(n.value);
      continue;
    }
    switch (n.tag) {
      case "strong":
      case "b":
        out += emphasize("**", n.children);
        break;
      case "em":
      case "i":
        out += emphasize("*", n.children);
        break;
      case "u":
        out += wrapU(n.children);
        break;
      case "a": {
        // Re-emit `[text](href)` when the href is safe; otherwise drop the link
        // wrapper and keep just the text (never emit an unsafe scheme).
        const inner = serializeInline(n.children);
        const href = n.href ? safeLinkHref(n.href) : null;
        out += href ? `[${inner}](${href})` : inner;
        break;
      }
      case "code":
        // Code content is LITERAL in markdown (the renderer never unescapes inside
        // backticks), so serialize it raw — escaping `*` here would print a stray `\`.
        out += "`" + serializeInlineRaw(n.children) + "`";
        break;
      case "br":
        out += "\n";
        break;
      case "td":
      case "th":
        // A pasted table (Word, Sheets, a careers page). This renderer has no table
        // syntax, so the cells necessarily degrade to prose — but they must stay
        // separate words: the unknown-tag fallback below concatenated them, turning
        // a salary row into "Salary60k". A trailing space is enough (the surrounding
        // block trims), and it also keeps consecutive ROWS apart.
        out += serializeInline(n.children) + " ";
        break;
      default:
        // span / font / unknown inline wrapper — keep the text, drop the tag.
        out += serializeInline(n.children);
    }
  }
  return out;
}

// Raw inline text with no markdown escaping — for `<code>` bodies, whose content
// the renderer treats as literal (so an escape would leak a backslash into it).
function serializeInlineRaw(nodes: HNode[]): string {
  let out = "";
  for (const n of nodes) {
    if (n.type === "text") out += n.value;
    else if (n.tag === "br") out += "\n";
    else out += serializeInlineRaw(n.children);
  }
  return out;
}

// Keep whitespace OUTSIDE the emphasis markers ("** bold **" is invalid) and skip
// an empty/whitespace-only span so we never emit bare `****`.
function emphasize(mark: string, children: HNode[]): string {
  const inner = serializeInline(children);
  if (!inner.trim()) return inner;
  const lead = inner.match(/^\s*/)![0];
  const trail = inner.match(/\s*$/)![0];
  return lead + mark + inner.trim() + mark + trail;
}

function wrapU(children: HNode[]): string {
  const inner = serializeInline(children);
  return inner.trim() ? `<u>${inner}</u>` : inner;
}

const isBlockEl = (n: HNode): boolean => n.type === "el" && BLOCK_TAGS.has(n.tag);

// Returns the node as a list element, or null — a plain narrowing helper rather than
// a `n is …` predicate, whose NEGATIVE branch would wrongly narrow an already-known
// element node to `never`.
const asList = (n: HNode): Extract<HNode, { type: "el" }> | null =>
  n.type === "el" && (n.tag === "ul" || n.tag === "ol") ? n : null;

// A list's items, FLATTENED to one level. A pasted list (Word, Google Docs, a
// careers page) and Chromium's own indent both nest — `<li>Backend<ul><li>Go</li></ul></li>`
// — but the renderer (Markdown.tsx) parses flat lists only. Serializing the <li>
// inline would send the nested <ul> through serializeInline's unknown-tag fallback,
// which concatenates its text straight onto the parent item ("- BackendGo": two
// bullets silently glued into one word). Lifting each nested item to its own item
// keeps every bullet's text separate — the most the flat renderer can carry.
// Empty items (`<li><br></li>` — the bullet Chromium creates on Enter) are dropped:
// they used to serialize as a bare "- ", which the renderer reads as a literal "-"
// paragraph that SPLITS the list in two on the published page.
function flattenListItems(list: Extract<HNode, { type: "el" }>): string[] {
  const items: string[] = [];
  for (const child of list.children) {
    if (child.type !== "el") continue;
    const bare = asList(child);
    if (bare) {
      // A list nested directly under a list, with no <li> wrapper.
      items.push(...flattenListItems(bare));
      continue;
    }
    if (child.tag !== "li") continue;
    const own = serializeInline(child.children.filter((c) => !asList(c))).trim();
    if (own) items.push(own);
    for (const c of child.children) {
      const nested = asList(c);
      if (nested) items.push(...flattenListItems(nested));
    }
  }
  return items;
}

function serializeBlocks(nodes: HNode[]): string {
  const blocks: string[] = [];
  // A run of consecutive inline siblings (text, <b>, <i>, <u>, <br>…) with no block
  // wrapper is ONE paragraph — e.g. contentEditable's first line lives directly in
  // the root before any Enter creates a <div>.
  let run: HNode[] = [];
  const flush = () => {
    if (!run.length) return;
    const s = serializeInline(run).trim();
    if (s) blocks.push(escapeLeadingMarker(s));
    run = [];
  };
  for (const n of nodes) {
    if (n.type !== "el" || !BLOCK_TAGS.has(n.tag)) {
      run.push(n);
      continue;
    }
    flush();
    switch (n.tag) {
      case "h1":
        blocks.push("# " + serializeInline(n.children).trim());
        break;
      case "h2":
        blocks.push("## " + serializeInline(n.children).trim());
        break;
      case "h3":
      case "h4":
      case "h5":
      case "h6":
        blocks.push("### " + serializeInline(n.children).trim());
        break;
      case "ul": {
        const items = flattenListItems(n);
        if (items.length) blocks.push(items.map((item) => "- " + item).join("\n"));
        break;
      }
      case "ol": {
        const items = flattenListItems(n);
        if (items.length) blocks.push(items.map((item, idx) => `${idx + 1}. ` + item).join("\n"));
        break;
      }
      // p / div, plus a stray <li> or a pasted <blockquote> outside its normal
      // parent. contentEditable nests blocks (a div of divs) and a pasted quote
      // carries its own <p> run — recurse in that case, otherwise the block is one
      // paragraph line. Without the recursion a <blockquote><p>one</p><p>two</p>
      // collapsed to "onetwo": two paragraphs glued into one word.
      default: {
        if (n.children.some(isBlockEl)) {
          const inner = serializeBlocks(n.children);
          if (inner) blocks.push(inner);
        } else {
          const inline = serializeInline(n.children).trim();
          if (inline) blocks.push(escapeLeadingMarker(inline));
        }
      }
    }
  }
  flush();
  // Join blocks with a blank line — EXCEPT a heading attaches to the block right
  // after it with a single newline (`## H\ncontent`). That matches how JD
  // templates are authored and, critically, keeps render-template.ts's "heading
  // followed by a blank line ⇒ empty section, drop it" rule from firing on a
  // FILLED section after a round-trip.
  let out = "";
  for (let idx = 0; idx < blocks.length; idx++) {
    if (idx === 0) {
      out = blocks[0];
      continue;
    }
    out += (/^#{1,3} /.test(blocks[idx - 1]) ? "\n" : "\n\n") + blocks[idx];
  }
  return out;
}

export function htmlToMarkdown(html: string): string {
  return serializeBlocks(parseHtml(html || ""))
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
