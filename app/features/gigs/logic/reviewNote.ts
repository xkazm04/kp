// ---------------------------------------------------------------------------
// The reviewer agent's note, read into its parts
// ---------------------------------------------------------------------------

/** A pre-send review as the reviewer agent writes it: a bracketed header naming who ran
 *  it, a lead with its verdict word (BLOCKER / WARNINGS), numbered must-dos "1) ... 2) ...",
 *  "Checks run: a | b" and "Defects: BLOCKER: x | y". A note in no such shape (the
 *  operator's own words) reads as a plain lead. Nothing is dropped: lead, items, checks and
 *  defects together hold the whole text. */
export type ReviewNote = {
  /** The bracketed header, verbatim; null when the note has none (the operator wrote it). */
  header: string | null;
  /** True when the header names a reviewer agent. */
  byAgent: boolean;
  /** The review cycle's date from the header, when it names one. */
  cycle: string | null;
  lead: string;
  items: string[];
  checks: string[];
  defects: { text: string; blocker: boolean }[];
  verdict: "blocker" | "warnings" | "note";
  blockers: number;
  length: number;
};

export function parseReviewNote(note: string | null | undefined): ReviewNote | null {
  if (!note || !note.trim()) return null;
  let text = note.trim();
  let header: string | null = null;
  const head = /^\[([^\]]+)\]\s*/.exec(text);
  if (head) {
    header = head[1];
    text = text.slice(head[0].length);
  }
  let defects: { text: string; blocker: boolean }[] = [];
  const di = text.search(/\bDefects:\s*/);
  if (di >= 0) {
    defects = text
      .slice(di)
      .replace(/^Defects:\s*/, "")
      .split(/\s\|\s/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => ({ blocker: /^BLOCKER\b/i.test(s), text: s.replace(/^BLOCKER:\s*/i, "") }));
    text = text.slice(0, di).trim();
  }
  let checks: string[] = [];
  const ci = text.search(/\bChecks run:\s*/);
  if (ci >= 0) {
    checks = text
      .slice(ci)
      .replace(/^Checks run:\s*/, "")
      .split(/\s\|\s/)
      .map((s) => s.trim())
      .filter(Boolean);
    text = text.slice(0, ci).trim();
  }
  const parts = text.split(/\s(?=\(?\d{1,2}[).]\s)/);
  let lead = parts.shift() ?? "";
  const items: string[] = [];
  for (const p of parts) {
    const m = /^\(?(\d{1,2})[).]\s*([\s\S]*)$/.exec(p);
    if (m) items.push(m[2].trim());
    else lead += ` ${p}`;
  }
  const blockers = defects.filter((d) => d.blocker).length + (/(^|\s)BLOCKER\b/.test(lead) ? 1 : 0);
  const cycle = header ? (/(\d{4}-\d{2}-\d{2})/.exec(header)?.[1] ?? null) : null;
  return {
    header,
    byAgent: header !== null && /reviewer agent/i.test(header),
    cycle,
    lead: lead.trim(),
    items,
    checks,
    defects,
    verdict: blockers > 0 ? "blocker" : /WARNINGS?/.test(lead) ? "warnings" : "note",
    blockers,
    length: note.length,
  };
}

/** Phrases a note quotes ('prevents repeats', "3x²"), 3-90 characters with a letter. */
export function quotedPhrases(text: string): string[] {
  const out: string[] = [];
  const re = /(^|[\s(\[:,])(['"“‘])([^'"“”‘’\n]{3,90}?)(['"”’])(?=[\s.,;:)!?\]]|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) if (/[a-z]/i.test(m[3])) out.push(m[3].trim());
  return out;
}
