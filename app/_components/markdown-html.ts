// Markdown ⇄ HTML for the RichTextEditor (WYSIWYG). Both directions are pure
// string→string so they unit-test in node without a DOM, and so the editor can
// seed its contentEditable (markdownToHtml) and read it back (htmlToMarkdown on
// the element's innerHTML) with a stable round-trip.
//
// Supported subset — matches app/_components/Markdown.tsx (the renderer) plus
// <u> underline: # / ## / ### headings, - / * bullets, 1. ordered lists,
// blank-line paragraphs, and inline **bold**, *italic*, `code`, <u>underline</u>.
// Template {{placeholders}} carry no markdown meaning, so they pass through as
// plain text untouched. The HTML side also tolerates the tags Chromium's
// contentEditable emits (b/strong, i/em, u, div, br, span) so an edit round-trips.

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

// ── Markdown → HTML ─────────────────────────────────────────────────────────

// Inline: the FIRST of **bold**, *italic*, `code`, <u>…</u> wins left-to-right
// (bold before italic so `**` beats `*`); bold/italic/underline recurse so nested
// emphasis renders, code is literal. Everything else is HTML-escaped so setting
// innerHTML with the result is safe.
function inlineToHtml(text: string): string {
  const re = /\*\*([\s\S]+?)\*\*|\*([\s\S]+?)\*|`([^`]+)`|<u>([\s\S]*?)<\/u>/;
  let out = "";
  let rest = text;
  while (rest.length) {
    const m = re.exec(rest);
    if (!m) {
      out += escapeHtml(rest);
      break;
    }
    if (m.index > 0) out += escapeHtml(rest.slice(0, m.index));
    if (m[1] !== undefined) out += `<strong>${inlineToHtml(m[1])}</strong>`;
    else if (m[2] !== undefined) out += `<em>${inlineToHtml(m[2])}</em>`;
    else if (m[3] !== undefined) out += `<code>${escapeHtml(m[3])}</code>`;
    else out += `<u>${inlineToHtml(m[4])}</u>`;
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

type HNode = { type: "text"; value: string } | { type: "el"; tag: string; children: HNode[] };

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
      out += n.value;
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
      case "code":
        out += "`" + serializeInline(n.children) + "`";
        break;
      case "br":
        out += "\n";
        break;
      default:
        // span / font / unknown inline wrapper — keep the text, drop the tag.
        out += serializeInline(n.children);
    }
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

function serializeBlocks(nodes: HNode[]): string {
  const blocks: string[] = [];
  // A run of consecutive inline siblings (text, <b>, <i>, <u>, <br>…) with no block
  // wrapper is ONE paragraph — e.g. contentEditable's first line lives directly in
  // the root before any Enter creates a <div>.
  let run: HNode[] = [];
  const flush = () => {
    if (!run.length) return;
    const s = serializeInline(run).trim();
    if (s) blocks.push(s);
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
        const items = n.children.filter((c): c is Extract<HNode, { type: "el" }> => c.type === "el" && c.tag === "li");
        if (items.length) blocks.push(items.map((li) => "- " + serializeInline(li.children).trim()).join("\n"));
        break;
      }
      case "ol": {
        const items = n.children.filter((c): c is Extract<HNode, { type: "el" }> => c.type === "el" && c.tag === "li");
        if (items.length) blocks.push(items.map((li, idx) => `${idx + 1}. ` + serializeInline(li.children).trim()).join("\n"));
        break;
      }
      case "p":
      case "div": {
        // contentEditable can nest blocks (a div of divs) — recurse in that case,
        // otherwise the block is one paragraph line.
        if (n.children.some(isBlockEl)) {
          const inner = serializeBlocks(n.children);
          if (inner) blocks.push(inner);
        } else {
          const inline = serializeInline(n.children).trim();
          if (inline) blocks.push(inline);
        }
        break;
      }
      default: {
        // stray <li> / <blockquote> outside its normal parent → a paragraph.
        const inline = serializeInline(n.children).trim();
        if (inline) blocks.push(inline);
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
