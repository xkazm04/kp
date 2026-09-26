// The designed CV's round trip, the pure half: what the sheet SAYS to a machine, and the
// check that an extraction of the exported file still says it.
//
// Registry recruiting/cv-presentation-and-parseability, techniques
// parse-safe-reading-order and export-format-and-round-trip-verification: a builder that
// never extracts its own output has not seen the document it ships. The render + extract
// half needs a browser and Python, so it lives in scripts/cv/roundtrip.mjs (a declared dev
// tool); this file is what both that script and the designer share, and what
// `node --test` holds without either.
//
//   cvReadingLines(doc)  the text of the sheet in the order DesignedCv writes it - the
//                        order a content-order extractor gets back from the PDF (the
//                        round trip compares the two, per template). The designer shows
//                        it as "How a parser reads it".
//   checkRoundTrip(...)  an extraction (content order or positional) against the model:
//                        the name first, each entry's title / employer / dates together,
//                        every bullet once and whole, nothing missing, diacritics intact,
//                        nothing the model does not hold.

import { CV_HEADINGS, type CvDocument, type CvRole } from "./cvDocument";
import { CV_ORG_SEPARATOR, skillText } from "./cvSheet";

function entryHead(r: Pick<CvRole, "role" | "org" | "dates">): string {
  const head = r.org ? `${r.role}${CV_ORG_SEPARATOR}${r.org}` : r.role;
  return r.dates ? `${head}  ${r.dates}` : head;
}

/** The sheet's text in document order - one entry per line, as DesignedCv writes it on
 *  every template (the DOM order is shared; only cv.css differs). */
export function cvReadingLines(doc: CvDocument): string[] {
  const h = CV_HEADINGS[doc.lang];
  const out: string[] = [doc.name];
  if (doc.headline) out.push(doc.headline);
  if (doc.objective) out.push(doc.objective);
  const contact = [doc.location, ...doc.contacts.map((c) => c.value)].filter(Boolean);
  if (contact.length) out.push(contact.join(" · "));
  if (doc.summary) out.push("", h.summary, doc.summary);
  const entries = (heading: string, roles: CvRole[]) => {
    if (!roles.length) return;
    out.push("", heading);
    for (const r of roles) {
      out.push(entryHead(r));
      if (!r.compact) for (const b of r.bullets) out.push(`- ${b.lead ? `${b.lead}: ` : ""}${b.text}`);
    }
  };
  entries(h.experience, doc.experience);
  entries(h.projects, doc.projects);
  if (doc.education.length) {
    out.push("", h.education);
    for (const e of doc.education) out.push(entryHead({ role: e.title, org: e.detail, dates: e.dates }));
  }
  if (doc.skills.length) {
    out.push("", h.skills);
    for (const g of doc.skills) {
      const items = g.items.map(skillText).join(", ");
      out.push(g.title ? `${g.title}: ${items}` : items);
    }
  }
  if (doc.languages.length) out.push("", h.languages, doc.languages.join(", "));
  return out;
}

// ── the check ──────────────────────────────────────────────────────────────────────

export const ROUND_TRIP_CHECKS = ["nameFirst", "entriesTogether", "bulletsWhole", "nothingMissing", "diacritics", "nothingForeign"] as const;
export type RoundTripCheck = (typeof ROUND_TRIP_CHECKS)[number];
export type RoundTripFinding = { check: RoundTripCheck; detail: string };
export type RoundTripResult = { pass: boolean; checks: Record<RoundTripCheck, boolean>; findings: RoundTripFinding[] };

/** Compared text: compatibility-composed (a ligature glyph is its letters), dashes and
 *  spaces unified, case folded - but diacritics KEPT, since losing them is a finding. */
export function normText(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/[‐-―−]/g, "-")
    .replace(/[  -​ ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase();
}

const SEPARATORS = /^[\s,.;:·•|/()\-–—]*$/u;
const TOKEN = /[\p{L}\p{N}]+/gu;

/** A token with its diacritics removed - only to tell "stripped" from "missing". */
function fold(t: string): string {
  return t.normalize("NFD").replace(/\p{M}/gu, "");
}

function tokens(s: string): string[] {
  return normText(s).match(TOKEN) ?? [];
}

function countOf(hay: string, needle: string): number {
  if (!needle) return 0;
  let n = 0;
  for (let at = hay.indexOf(needle); at >= 0; at = hay.indexOf(needle, at + 1)) n++;
  return n;
}

function indexesOf(hay: string, needle: string): number[] {
  const out: number[] = [];
  if (!needle) return out;
  for (let at = hay.indexOf(needle); at >= 0; at = hay.indexOf(needle, at + 1)) out.push(at);
  return out;
}

/** Title, employer and dates of one entry appear in one run with nothing but separators
 *  between them, in any order (a hung date column may extract before the title). */
function together(hay: string, parts: string[]): boolean {
  const [first, ...rest] = parts;
  if (!first) return true;
  const slack = 12;
  for (const at of indexesOf(hay, first)) {
    const span = parts.reduce((n, p) => n + p.length, 0) + slack * parts.length;
    const lo = Math.max(0, at - span);
    const hi = Math.min(hay.length, at + first.length + span);
    const windowText = hay.slice(lo, hi);
    const local = at - lo;
    // Place each remaining part at its occurrence nearest the first part.
    const spans: [number, number][] = [[local, local + first.length]];
    let ok = true;
    for (const p of rest) {
      const hits = indexesOf(windowText, p).filter((i) => !spans.some(([s, e]) => i < e && i + p.length > s));
      if (!hits.length) {
        ok = false;
        break;
      }
      const best = hits.reduce((a, b) => (Math.abs(b - local) < Math.abs(a - local) ? b : a));
      spans.push([best, best + p.length]);
    }
    if (!ok) continue;
    spans.sort((a, b) => a[0] - b[0]);
    let gapsClean = true;
    for (let i = 1; i < spans.length; i++) {
      if (!SEPARATORS.test(windowText.slice(spans[i - 1]![1], spans[i]![0]))) gapsClean = false;
    }
    if (gapsClean) return true;
  }
  return false;
}

/** The strings the model holds, each with where it came from (for a finding's detail). */
function modelStrings(doc: CvDocument): { what: string; text: string }[] {
  const h = CV_HEADINGS[doc.lang];
  const out: { what: string; text: string }[] = [{ what: "name", text: doc.name }];
  const add = (what: string, text: string | null | undefined) => {
    if (text && text.trim()) out.push({ what, text });
  };
  add("headline", doc.headline);
  add("objective", doc.objective);
  add("location", doc.location);
  for (const c of doc.contacts) add(`contact ${c.kind}`, c.value);
  if (doc.summary) add("heading", h.summary);
  add("summary", doc.summary);
  const roles = (heading: string, list: CvRole[]) => {
    if (list.length) add("heading", heading);
    for (const r of list) {
      add("title", r.role);
      add("employer", r.org);
      add("dates", r.dates);
      if (!r.compact) for (const b of r.bullets) add("bullet", b.lead ? `${b.lead}: ${b.text}` : b.text);
    }
  };
  roles(h.experience, doc.experience);
  roles(h.projects, doc.projects);
  if (doc.education.length) add("heading", h.education);
  for (const e of doc.education) {
    add("education", e.title);
    add("education detail", e.detail);
    add("dates", e.dates);
  }
  if (doc.skills.length) add("heading", h.skills);
  for (const g of doc.skills) {
    add("skill group", g.title);
    for (const it of g.items) add("skill", skillText(it));
  }
  if (doc.languages.length) add("heading", h.languages);
  for (const l of doc.languages) add("language", l);
  return out;
}

/** Check one extraction of the exported file against the model it was rendered from. */
export function checkRoundTrip(doc: CvDocument, extracted: string): RoundTripResult {
  const findings: RoundTripFinding[] = [];
  const lines = extracted
    .split(/\r?\n/)
    .map(normText)
    .filter((l) => l && !SEPARATORS.test(l));
  const hay = lines.join(" ");

  // 1. The name within the first two lines.
  const name = normText(doc.name);
  if (!lines.slice(0, 2).some((l) => l.includes(name))) findings.push({ check: "nameFirst", detail: `first lines: ${JSON.stringify(lines.slice(0, 2))}` });

  // 2. Each entry's title, employer and dates together.
  const entries: { role: string; org: string | null; dates: string | null }[] = [
    ...doc.experience,
    ...(doc.projects),
    ...doc.education.map((e) => ({ role: e.title, org: e.detail, dates: e.dates })),
  ];
  for (const r of entries) {
    const parts = [r.role, r.org, r.dates].filter((p): p is string => !!p && !!p.trim()).map(normText);
    if (parts.length > 1 && !together(hay, parts)) findings.push({ check: "entriesTogether", detail: `${r.role} / ${r.org ?? "-"} / ${r.dates ?? "-"}` });
  }

  // 3. Every bullet once, whole: present word-for-word and not repeated. A bullet whose
  //    words are all there but not in one run was split by something else - interleaved.
  const strings = modelStrings(doc);
  for (const s of strings.filter((x) => x.what === "bullet" || x.what === "summary")) {
    const n = countOf(hay, normText(s.text));
    if (n === 1) continue;
    if (n > 1) findings.push({ check: "bulletsWhole", detail: `repeated ${n}x: ${s.text.slice(0, 60)}` });
    else if (tokens(s.text).every((t) => hay.includes(t))) findings.push({ check: "bulletsWhole", detail: `interleaved: ${s.text.slice(0, 60)}` });
  }

  // 4. Nothing in the model missing from the extraction.
  for (const s of strings) {
    const text = normText(s.text);
    if (hay.includes(text)) continue;
    // A bullet split across a page break keeps its words; that is reported under 3.
    if ((s.what === "bullet" || s.what === "summary") && tokens(s.text).every((t) => hay.includes(t))) continue;
    findings.push({ check: "nothingMissing", detail: `${s.what}: ${s.text.slice(0, 60)}` });
  }

  // 5. Diacritics intact: a model word with a non-ASCII letter never comes back stripped
  //    or mangled (a word missing outright is reported under 4, not twice).
  if (/�/.test(extracted)) findings.push({ check: "diacritics", detail: "replacement character (U+FFFD) in the extraction" });
  const accented = new Set(strings.flatMap((s) => tokens(s.text)).filter((t) => /[^\x00-\x7f]/.test(t)));
  const hayTokens = new Set(hay.match(TOKEN) ?? []);
  const hayFolded = new Set([...hayTokens].map(fold));
  for (const t of accented) if (!hayTokens.has(t) && hayFolded.has(fold(t))) findings.push({ check: "diacritics", detail: t });

  // 6. Nothing the model does not hold (a hidden word, a placeholder, a stray label).
  const known = new Set(strings.flatMap((s) => tokens(s.text)));
  const foreign = [...hayTokens].filter((t) => !known.has(t));
  if (foreign.length) findings.push({ check: "nothingForeign", detail: foreign.slice(0, 12).join(", ") });

  const checks = Object.fromEntries(ROUND_TRIP_CHECKS.map((c) => [c, !findings.some((f) => f.check === c)])) as Record<RoundTripCheck, boolean>;
  return { pass: findings.length === 0, checks, findings };
}
