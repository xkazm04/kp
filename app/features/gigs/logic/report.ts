import type { GigAttempt, GigOutcome, GigPlanRow } from "@/app/_lib/gigs/types";

// ---------------------------------------------------------------------------
// The gig's report (the proof's Summary tab, proof/report/)
// ---------------------------------------------------------------------------
//
// One page that grows with the gig: the gig itself, what it asks, the plans, the progress,
// the draft, the evidence, the record. A section whose time has not come is not an empty
// box: the index lists it greyed with the reason. These derivations decide which sections
// are open, set the brief's prose as a lead and points (HTML, not rendered Markdown), and
// add up what the gig has cost so far. Pure: pinned by report.test.ts.

export const REPORT_SECTIONS = ["gig", "asks", "plans", "progress", "draft", "evidence", "record"] as const;
export type ReportSection = (typeof REPORT_SECTIONS)[number];

/** The DOM id of a section's heading (the index links to it, a jump focuses it). */
export const reportAnchor = (s: ReportSection) => `rp-${s}`;

export type ReportFacts = {
  brief: boolean;
  /** Asks and expected challenges the brief names. */
  asks: number;
  /** The accepted plan is being followed: a persona or a milestone exists for it. */
  paired: boolean;
  attempt: boolean;
  /** A quarantined listing: its "draft" is the quarantine stamp, which is worth reading. */
  suspect: boolean;
  deliverable: boolean;
  /** Attempts on the gig's record (null while the record loads). */
  attempts: number | null;
};

/** Which sections have something in them for this gig's state. The gig and the plans are
 *  always open: the plans section is where Research / Generate plans live. */
export function reportOpen(f: ReportFacts): Record<ReportSection, boolean> {
  return {
    gig: true,
    asks: f.brief && f.asks > 0,
    plans: true,
    progress: f.paired,
    draft: f.attempt || f.suspect,
    evidence: f.deliverable,
    record: (f.attempts ?? (f.attempt ? 1 : 0)) > 0,
  };
}

/** The heading research.ts writes for the brief's asks (GIG_BRIEF_HEADINGS.asks). Restated
 *  rather than imported because research.ts reaches the server; report.test.ts reads the
 *  source and fails if the two disagree. */
export const BRIEF_ASKS_HEADING = "What it asks for";

/** The bullets of the brief's "What it asks for" section, as plain text; [] when the brief
 *  has no such section or it states no deliverables. */
export function briefAsks(markdown: string | null | undefined): string[] {
  if (!markdown) return [];
  const lines = markdown.split(/\r?\n/);
  const at = lines.findIndex((l) => l.trim() === `## ${BRIEF_ASKS_HEADING}`);
  if (at < 0) return [];
  const out: string[] = [];
  for (const l of lines.slice(at + 1)) {
    if (/^##\s/.test(l)) break;
    const m = /^\s*[-*•]\s+(.*)$/.exec(l);
    if (m && m[1].trim()) out.push(plainInline(m[1].trim()));
  }
  return out;
}

/** Inline Markdown as the words it carries: bold and code marks dropped, a link as its text. */
export function plainInline(s: string): string {
  return s
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\\([\\`*_[\]()#+\-.!])/g, "$1");
}

/** A summary or "What the gig is" set as a lead paragraph and points: the prose before the
 *  first list line is the lead, every list line a point. Headings are dropped; a paragraph
 *  after the list joins the points. Nothing is reworded. */
export function leadOf(text: string): { lead: string; points: string[] } {
  const lead: string[] = [];
  const points: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const l = raw.trim();
    if (!l || /^#{1,4}\s/.test(l)) continue;
    const m = /^(?:[-*•]|\d+[.)])\s+(.*)$/.exec(l);
    if (m) points.push(plainInline(m[1]));
    else if (points.length === 0) lead.push(plainInline(l));
    else points.push(plainInline(l));
  }
  return { lead: lead.join(" "), points };
}

/** The lead split where the highlighter stops: its first clause (up to the first comma,
 *  semicolon, colon or dash inside the first sentence), else the first sentence. A clause
 *  shorter than 12 characters is too short to carry the point, so the sentence is used. */
export function firstClause(lead: string): [string, string] {
  const s = lead.trim();
  const end = /[.!?](?=\s)/.exec(s);
  const sentence = end ? s.slice(0, end.index + 1) : s;
  const cut = /[,;:](?=\s)|\s[-–—]\s/.exec(sentence);
  const at = cut && cut.index >= 12 ? cut.index : sentence.length;
  return [s.slice(0, at), s.slice(at)];
}

export type Spend = {
  /** Plans and drafts together; null when nothing that ran reported a cost. */
  total: number | null;
  plans: number | null;
  drafts: number | null;
  /** Finished calls that reported no cost: the total is a floor while this is above 0. */
  unreported: number;
  /** Anything has run at all (a plan seat or an agent attempt that finished). */
  ran: boolean;
};

const sum = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) : null);

/** What the gig has cost so far: every finished plan seat and every agent attempt. A call
 *  still running has no cost yet (not "unreported"); a finished one with none is counted as
 *  unreported, never as $0. */
export function spendSoFar(plans: readonly GigPlanRow[] | null, attempts: readonly GigAttempt[]): Spend {
  const doneSeats = (plans ?? []).filter((p) => p.status === "ready" || p.status === "failed");
  const doneRuns = attempts.filter((a) => a.status !== "dispatched" && a.status !== "running");
  const p = sum(doneSeats.flatMap((x) => (x.costUsd === null ? [] : [x.costUsd])));
  const d = sum(doneRuns.flatMap((x) => (x.costUsd === null ? [] : [x.costUsd])));
  const unreported = doneSeats.filter((x) => x.costUsd === null).length + doneRuns.filter((x) => x.costUsd === null).length;
  return { total: p === null && d === null ? null : (p ?? 0) + (d ?? 0), plans: p, drafts: d, unreported, ran: doneSeats.length + doneRuns.length > 0 };
}

export type TimelineRow = { n: number; attempt: GigAttempt; outcomes: GigOutcome[] };

/** Attempts numbered in the order they ran, listed newest first, each with its verdicts;
 *  verdicts recorded against no attempt are returned apart. */
export function attemptTimeline(attempts: readonly GigAttempt[], outcomes: readonly GigOutcome[]): { rows: TimelineRow[]; loose: GigOutcome[] } {
  const by = new Map<string, GigOutcome[]>();
  for (const o of outcomes) by.set(o.attemptId ?? "", [...(by.get(o.attemptId ?? "") ?? []), o]);
  const rows = attempts.map((attempt, i) => ({ n: i + 1, attempt, outcomes: by.get(attempt.id) ?? [] })).reverse();
  return { rows, loose: by.get("") ?? [] };
}

/** A listing written in another language than English (a brief before v4 knows none). */
export function foreignLanguage(language: string | null | undefined): string | null {
  const code = language?.trim().toLowerCase() ?? "";
  return code && code !== "en" && !code.startsWith("en-") ? code : null;
}

/** The listing's first paragraph for the hero of a gig nobody researched yet, cut on a word
 *  at about 420 characters (the Listing tab holds all of it). */
export function listingOpening(text: string, max = 420): string {
  const first = text.trim().split(/\n\s*\n/)[0]?.replace(/\s+/g, " ").trim() ?? "";
  if (first.length <= max) return first;
  const cut = first.slice(0, max);
  const at = cut.lastIndexOf(" ");
  return `${(at > max * 0.6 ? cut.slice(0, at) : cut).replace(/[\s,;:.-]+$/, "")}…`;
}
