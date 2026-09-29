import { bySeverity, draftLines, type DraftLintFinding } from "@/app/_lib/gigs/draft-lint";
import { quotedPhrases, type ReviewNote } from "./reviewNote";

// ---------------------------------------------------------------------------
// The galley: paragraphs, and the notes pinned beside them
// ---------------------------------------------------------------------------

export type Paragraph = { text: string; /** 1-based, as draftLines numbers them. */ firstLine: number; lines: number };

/** The draft as paragraphs (blank lines separate them), each knowing which lines of the
 *  draft it holds - so a lint finding anchored to a line lands in its paragraph. */
export function draftParagraphs(text: string): Paragraph[] {
  const lines = draftLines(text);
  const out: Paragraph[] = [];
  let buf: string[] = [];
  let start = 0;
  lines.forEach((line, i) => {
    if (line.trim() === "") {
      if (buf.length) out.push({ text: buf.join("\n"), firstLine: start + 1, lines: buf.length });
      buf = [];
    } else {
      if (!buf.length) start = i;
      buf.push(line);
    }
  });
  if (buf.length) out.push({ text: buf.join("\n"), firstLine: start + 1, lines: buf.length });
  return out;
}

export type MarginNote = {
  /** a, b, c... in reading order; the same letter rides the underline and the note. */
  key: string;
  para: number;
  /** The underlined span inside the paragraph's text. */
  start: number;
  end: number;
  source: "lint" | "review";
  blocker: boolean;
  /** A lint finding's own record (its text is resolved from the catalog). */
  finding: DraftLintFinding | null;
  /** A reviewer note's text, verbatim. */
  text: string | null;
  /** For a reviewer note: "defect" or "must-do N". */
  role: string | null;
};

export type LooseNote = { text: string; blocker: boolean; role: string };

/** Pin every note that names a place in the draft beside that place: a lint finding
 *  anchored to a line and an excerpt, or a reviewer defect / must-do that quotes a phrase
 *  the draft contains (case-insensitive). A reviewer note that quotes nothing in the draft
 *  is "loose" and is listed on the slip instead - never dropped. Findings with no line stay
 *  on the slip alone (they are the slip's own rows). */
export function pinNotes(paras: readonly Paragraph[], findings: readonly DraftLintFinding[], note: ReviewNote | null): { pinned: MarginNote[]; loose: LooseNote[] } {
  const pinned: Omit<MarginNote, "key">[] = [];
  for (const f of bySeverity(findings)) {
    if (f.line === null) continue;
    const excerpt = typeof f.params.excerpt === "string" ? f.params.excerpt : null;
    const p = paras.findIndex((x) => f.line! >= x.firstLine && f.line! < x.firstLine + x.lines);
    if (p < 0 || !excerpt) continue;
    const lines = paras[p].text.split("\n");
    const lineIdx = f.line - paras[p].firstLine;
    const offset = lines.slice(0, lineIdx).reduce((n, l) => n + l.length + 1, 0);
    const at = lines[lineIdx].indexOf(excerpt);
    if (at < 0) continue;
    pinned.push({ para: p, start: offset + at, end: offset + at + excerpt.length, source: "lint", blocker: f.severity === "blocker", finding: f, text: null, role: null });
  }
  const loose: LooseNote[] = [];
  if (note) {
    const notes = [
      ...note.defects.map((d) => ({ text: d.text, blocker: d.blocker, role: "defect" })),
      ...note.items.map((t, i) => ({ text: t, blocker: false, role: `must-do ${i + 1}` })),
    ];
    const lower = paras.map((p) => p.text.toLowerCase());
    for (const n of notes) {
      let hit: { para: number; start: number; end: number } | null = null;
      for (const q of quotedPhrases(n.text)) {
        const ql = q.toLowerCase();
        if (ql.length < 4) continue;
        const p = lower.findIndex((t) => t.includes(ql));
        if (p >= 0) {
          const start = lower[p].indexOf(ql);
          hit = { para: p, start, end: start + ql.length };
          break;
        }
      }
      if (hit) pinned.push({ ...hit, source: "review", blocker: n.blocker, finding: null, text: n.text, role: n.role });
      else loose.push(n);
    }
  }
  pinned.sort((a, b) => a.para - b.para || a.start - b.start);
  return { pinned: pinned.map((n, i) => ({ ...n, key: letterKey(i) })), loose };
}

/** a..z, then aa, ab... - a key is never reused within one galley. */
export function letterKey(i: number): string {
  let n = i;
  let s = "";
  do {
    s = String.fromCharCode(97 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

export type Span = { text: string; mark: MarginNote[] | null };

/** A paragraph cut into plain and underlined runs. Overlapping notes share one run;
 *  every note's letter rides the run that ends it. */
export function paragraphSpans(text: string, notes: readonly MarginNote[]): Span[] {
  const cuts = new Set<number>([0, text.length]);
  for (const n of notes) {
    cuts.add(Math.max(0, Math.min(text.length, n.start)));
    cuts.add(Math.max(0, Math.min(text.length, n.end)));
  }
  const points = [...cuts].sort((a, b) => a - b);
  const out: Span[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const [a, b] = [points[i], points[i + 1]];
    if (a === b) continue;
    const covering = notes.filter((n) => n.start <= a && n.end >= b);
    out.push({ text: text.slice(a, b), mark: covering.length ? covering : null });
  }
  return out;
}
