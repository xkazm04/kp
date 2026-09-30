import type { GigAttempt, GigOutcome, GigPlanRow } from "@/app/_lib/gigs/types";

// ---------------------------------------------------------------------------
// The gig's Summary (the proof's Summary tab, proof/summary/)
// ---------------------------------------------------------------------------
//
// The in-app Summary is a quick overview beside the decision sidebar: a compact header, then
// folding panels only while they apply - the bid, the draft, the plans, the brief (the long
// read is the full HTML report, a file the model writes and rewrites as the gig moves). These
// derivations decide which panels show, set the brief's prose as a lead and points (HTML, not
// rendered Markdown), and add up what the gig has cost so far. Pure: pinned by report.test.ts.

export const REPORT_SECTIONS = ["gig", "file", "brief", "plans", "bid", "draft"] as const;
export type ReportSection = (typeof REPORT_SECTIONS)[number];

/** The DOM id of a block's heading (a jump from the sign-off focuses it). */
export const reportAnchor = (s: ReportSection) => `rp-${s}`;

export type SummaryFacts = {
  brief: boolean;
  /** Plans in the shown round; null while they load. */
  plans: number | null;
  accepted: boolean;
  /** The latest attempt carries a draft to read. */
  draft: boolean;
  /** The proposal track (a freelance bid, logic/proposal.ts); absent = the build track. */
  proposalTrack?: boolean;
  /** The gig's proposal carries a bid message. */
  proposal?: boolean;
  /** The latest attempt is the draft kp wrote itself from the proposal. */
  kpDraft?: boolean;
};

/** Which working blocks the Summary shows under the hero, the report card and the brief.
 *  Plans: "accepted" once one is (a line and its steps), "choose" while plans wait for a
 *  pick or a brief waits for its first plans, nothing before the gig is researched. The bid
 *  (proposal track only): once a proposal or kp's own draft exists. kp's own draft IS the
 *  bid message, so it is proofed inside the bid block (`draftInBid`) instead of a second
 *  "Review the draft" block that would show the same words again. */
export function summaryBlocks(f: SummaryFacts): { plans: "choose" | "accepted" | null; bid: boolean; draft: boolean; draftInBid: boolean } {
  const bid = !!f.proposalTrack && (!!f.proposal || (f.draft && !!f.kpDraft));
  const draftInBid = bid && f.draft && !!f.kpDraft;
  return { plans: f.accepted ? "accepted" : f.plans || f.brief ? "choose" : null, bid, draft: f.draft && !draftInBid, draftInBid };
}

/** A plan's summary as its first sentence, cut on a word near `max` characters (the seat
 *  card is a glance; the report file holds the whole plan). */
export function firstSentence(text: string, max = 220): string {
  const s = text.replace(/\s+/g, " ").trim();
  const end = /[.!?](?=\s|$)/.exec(s);
  const first = end ? s.slice(0, end.index + 1) : s;
  if (first.length <= max) return first;
  const cut = first.slice(0, max);
  const at = cut.lastIndexOf(" ");
  return `${(at > max * 0.6 ? cut.slice(0, at) : cut).replace(/[\s,;:.-]+$/, "")}…`;
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
