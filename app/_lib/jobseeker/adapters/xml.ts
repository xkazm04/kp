// A regex XML reader for the three feed shapes this module meets — sitemaps
// (`<loc>`), RSS (`<item>` with CDATA) and Personio's `<position>` records. It reads
// elements by name and unwraps CDATA/entities; it is not a parser and does not claim
// to be one (ADR 0009: linkedom is for the rules engine only, and XML feeds do not
// need a DOM to yield a list of strings).

import { decodeEntities } from "../../job-posting-fetch";

export function xmlBlocks(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}\\s*>`, "gi");
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) out.push(m[1]);
  return out;
}

export function xmlText(block: string, tag: string): string | null {
  const m = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}\\s*>`, "i").exec(block);
  if (!m) return null;
  const inner = m[1].trim();
  const cdata = /^<!\[CDATA\[([\s\S]*?)\]\]>$/.exec(inner);
  const text = decodeEntities(cdata ? cdata[1] : inner).trim();
  return text || null;
}

export function xmlAttr(block: string, tag: string, attr: string): string | null {
  const m = new RegExp(`<${tag}\\b[^>]*\\b${attr}\\s*=\\s*["']([^"']*)["']`, "i").exec(block);
  return m ? decodeEntities(m[1]) : null;
}
