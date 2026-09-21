// Shape conditions and the authoring input.
//
// A page that fetched fine and yielded nothing is not "zero postings today" — it is
// the board's redesign, and the scan must say so (`collapsed`) instead of marking the
// whole source's postings absent. `isCollapsed` is that judgement; `reduceHtmlForAuthoring`
// is the other half of the loop — the REAL page, trimmed to what a rule author needs,
// so the LLM proposes from markup that exists rather than from a memory of the site.

import { parseHTML } from "linkedom";
import type { ExtractionRule, RuleDryRunResult } from "../types";

/** A rule the baseline saw matching at least this often is expected to keep matching. */
export const COLLAPSE_BASELINE_FLOOR = 5;

export function isCollapsed(
  perRule: RuleDryRunResult[],
  rules: ExtractionRule[],
  baseline: Record<string, number> | null
): boolean {
  const required = new Set(rules.filter((r) => r.required).map((r) => r.field));
  for (const r of perRule) {
    if (r.matched > 0) continue;
    if (required.has(r.field)) return true;
    if ((baseline?.[r.field] ?? 0) >= COLLAPSE_BASELINE_FLOOR) return true;
  }
  return false;
}

export const AUTHORING_MAX_CHARS = 40_000;
const KEEP_EXEMPLARS = 3;
const DROP_TAGS = new Set(["SCRIPT", "STYLE", "SVG", "NOSCRIPT", "TEMPLATE", "IFRAME", "CANVAS", "VIDEO", "AUDIO", "PICTURE", "SOURCE"]);
const KEEP_ATTRS = new Set(["class", "id", "href", "datetime", "itemprop", "itemtype", "type", "title", "rel", "name", "content", "translate"]);
const EMBEDDED_JSON_CAP = 2_000;

function signature(el: Element): string {
  return `${el.tagName}|${(el.getAttribute("class") ?? "").trim().split(/\s+/).sort().join(" ")}`;
}

/** Strip what a rule cannot target, keep the first three of every run of repeated
 *  siblings (with a count note in place of the rest), drop attributes a selector
 *  would not use, and cap the result. JSON-LD and `application/json` blocks are kept
 *  (truncated) because they are two of the four locator kinds. */
export function reduceHtmlForAuthoring(html: string): string {
  const { document } = parseHTML(html);
  const doc = document as unknown as Document;
  // Drop non-targetable elements, keeping the two script kinds a locator can read.
  for (const el of Array.from(doc.querySelectorAll("*"))) {
    if (!DROP_TAGS.has(el.tagName.toUpperCase())) continue;
    const type = (el.getAttribute("type") ?? "").toLowerCase();
    if (el.tagName.toUpperCase() === "SCRIPT" && (type === "application/ld+json" || type === "application/json")) {
      const text = (el.textContent ?? "").trim();
      if (text.length > EMBEDDED_JSON_CAP) el.textContent = `${text.slice(0, EMBEDDED_JSON_CAP)} /* …truncated ${text.length - EMBEDDED_JSON_CAP} chars */`;
      continue;
    }
    el.remove();
  }
  // Comments.
  const walker = (node: Node) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 8) child.parentNode?.removeChild(child);
      else if (child.nodeType === 1) walker(child);
    }
  };
  if (doc.documentElement) walker(doc.documentElement);
  // Repeated siblings → three exemplars + a note.
  for (const parent of Array.from(doc.querySelectorAll("*"))) {
    const children = Array.from(parent.children);
    if (children.length <= KEEP_EXEMPLARS) continue;
    const counts = new Map<string, number>();
    for (const c of children) counts.set(signature(c), (counts.get(signature(c)) ?? 0) + 1);
    const kept = new Map<string, number>();
    for (const c of children) {
      const sig = signature(c);
      const total = counts.get(sig) ?? 0;
      if (total <= KEEP_EXEMPLARS) continue;
      const seen = (kept.get(sig) ?? 0) + 1;
      kept.set(sig, seen);
      if (seen === KEEP_EXEMPLARS + 1) {
        const note = doc.createComment(` +${total - KEEP_EXEMPLARS} more <${c.tagName.toLowerCase()}> siblings like the ${KEEP_EXEMPLARS} above `);
        parent.insertBefore(note, c);
      }
      if (seen > KEEP_EXEMPLARS) c.remove();
    }
  }
  // Attributes a selector would not use.
  for (const el of Array.from(doc.querySelectorAll("*"))) {
    for (const attr of Array.from(el.attributes)) {
      if (KEEP_ATTRS.has(attr.name) || attr.name.startsWith("data-")) continue;
      el.removeAttribute(attr.name);
    }
  }
  const out = (doc.documentElement?.outerHTML ?? "").replace(/\n\s*\n/g, "\n");
  return out.length > AUTHORING_MAX_CHARS ? `${out.slice(0, AUTHORING_MAX_CHARS)}\n<!-- …truncated at ${AUTHORING_MAX_CHARS} chars -->` : out;
}
