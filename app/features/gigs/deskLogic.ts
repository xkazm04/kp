import { bySeverity, draftLines, type DraftLintFinding } from "@/app/_lib/gigs/draft-lint";
import { normalizeNicheLabel } from "@/app/_lib/gigs/match";
import type { Gig, GigArena, GigAttempt, GigKpi, GigKpiCell, GigStatus } from "@/app/_lib/gigs/types";
import { deadlineView, matchesSearch, reachedStep, type SpecialistRow } from "./gigsLogic";

// Pure derivations for the Gigs desk as the owner chose it from the gigs-calm contest
// (docs/features/gigs/README.md "The Gigs tab"): the front page's columns and the one
// urgency order every "what first?" reads, the whole file's filter and sort, the
// specialists folded into niches and their lanes by lifecycle stage, the reviewer agent's
// note read into parts, and the margin notes pinned to the paragraph they are about.
// No React, no fetch, the clock passed in - pinned by deskLogic.test.ts.

// ---------------------------------------------------------------------------
// The front page: what waits on the operator, and in which order
// ---------------------------------------------------------------------------

/** The front page's index columns, in the order they are read: work closest to done
 *  first. `record` (a verdict to record) appears only while something is out. */
export const FRONT_COLUMNS = ["ready", "proof", "quar", "record"] as const;
export type FrontColumn = (typeof FRONT_COLUMNS)[number];

export const COLUMN_STATUS: Readonly<Record<FrontColumn, GigStatus>> = {
  ready: "in_review",
  proof: "drafted",
  quar: "suspect",
  record: "sent",
};

export function frontColumnOf(status: GigStatus): FrontColumn | null {
  for (const c of FRONT_COLUMNS) if (COLUMN_STATUS[c] === status) return c;
  return null;
}

/** Ties within one deadline: the move closest to done goes first. */
const STEP_WEIGHT: Readonly<Record<FrontColumn, number>> = { ready: 0, proof: 1, quar: 2, record: 3 };

function waitingSince(gig: Gig, latest: GigAttempt | null): string {
  if (gig.status === "sent") return latest?.sentAt ?? latest?.updatedAt ?? gig.updatedAt;
  return latest?.createdAt ?? gig.updatedAt;
}

/** Every gig that waits on the operator, most urgent first: the nearest OPEN deadline
 *  first (a gig with no deadline, or one already closed, after every dated one), then the
 *  move closest to done (send, review, clear, record), then the one waiting longest. The
 *  header's "First", the lead proof and `N` all read this one order. */
export function urgencyQueue(gigs: readonly Gig[], attemptsByGig: Readonly<Record<string, GigAttempt>>, now: Date): Gig[] {
  const rows = gigs.flatMap((g) => {
    const col = frontColumnOf(g.status);
    if (!col) return [];
    const d = deadlineView(g.deadlineAt, now);
    const dated = d.state === "soon" || d.state === "open";
    const at = dated ? Date.parse(g.deadlineAt as string) : Number.POSITIVE_INFINITY;
    return [{ g, at, w: STEP_WEIGHT[col], since: waitingSince(g, attemptsByGig[g.id] ?? null) }];
  });
  rows.sort((a, b) => a.at - b.at || a.w - b.w || (a.since < b.since ? -1 : a.since > b.since ? 1 : a.g.id < b.g.id ? -1 : 1));
  return rows.map((r) => r.g);
}

/** The index columns, each in the urgency order. */
export function frontColumns(gigs: readonly Gig[], attemptsByGig: Readonly<Record<string, GigAttempt>>, now: Date): Record<FrontColumn, Gig[]> {
  const out: Record<FrontColumn, Gig[]> = { ready: [], proof: [], quar: [], record: [] };
  for (const g of urgencyQueue(gigs, attemptsByGig, now)) out[frontColumnOf(g.status)!].push(g);
  return out;
}

export type WaitCounts = { clear: number; review: number; send: number; record: number; total: number };

/** The header's "wait on you": the three judgements and the verdicts to record. Work
 *  sitting with an agent or the scan never pads it. */
export function waitCounts(cols: Readonly<Record<FrontColumn, readonly Gig[]>>): WaitCounts {
  const clear = cols.quar.length;
  const review = cols.proof.length;
  const send = cols.ready.length;
  const record = cols.record.length;
  return { clear, review, send, record, total: clear + review + send + record };
}

/** `N`: the gig after the one last opened in the urgency order, wrapping round; the first
 *  when nothing was opened yet; null when nothing waits. */
export function nextInQueue(queue: readonly Gig[], lastGigId: string | null): Gig | null {
  if (queue.length === 0) return null;
  const at = lastGigId ? queue.findIndex((g) => g.id === lastGigId) : -1;
  return queue[(at + 1) % queue.length];
}

/** The nearest open deadline among the gigs that wait on the operator, or null. */
export function firstClosing(queue: readonly Gig[], now: Date): { gig: Gig; days: number } | null {
  for (const g of queue) {
    const d = deadlineView(g.deadlineAt, now);
    if (d.state === "soon" || d.state === "open") return { gig: g, days: Math.max(0, d.days) };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Walking a list from a proof: ← / →
// ---------------------------------------------------------------------------

export type ListPosition = { prev: string | null; next: string | null; index: number; total: number };

/** Where a gig sits in the list its proof was opened from. No wrap: the ends answer null.
 *  Null when the gig is not in the list (it moved out of it after a write). */
export function listNeighbours(ids: readonly string[], id: string): ListPosition | null {
  const i = ids.indexOf(id);
  if (i < 0) return null;
  return { prev: i > 0 ? ids[i - 1] : null, next: i < ids.length - 1 ? ids[i + 1] : null, index: i + 1, total: ids.length };
}

/** After a decline or a write that moves the gig out of its list: the next gig, else the
 *  previous, else nothing (the front page). */
export function afterLeavingList(pos: ListPosition | null): string | null {
  return pos?.next ?? pos?.prev ?? null;
}

// ---------------------------------------------------------------------------
// Specialists, folded into niches
// ---------------------------------------------------------------------------

/** Hire states in the order a niche's lead is picked: a working hire before one on its
 *  way, before a retired or failed one. Unknown states sort last. */
const HIRE_RANK: Readonly<Record<string, number>> = { active: 0, onboarding: 1, pending_approval: 2, dispatched: 3, retired: 4, failed: 5, rejected: 6 };
const hireRank = (s: SpecialistRow) => (s.hire ? (HIRE_RANK[s.hire.status] ?? 7) : 8);

export type Niche = {
  /** `arena|niche`, the niche normalized the way match.ts compares niches. */
  key: string;
  arena: GigArena;
  /** The niche as the lead hire states it. */
  label: string;
  /** Every hire of this niche, lead first. */
  hires: SpecialistRow[];
  lead: SpecialistRow;
  earlier: SpecialistRow[];
};

export function nicheKeyOf(s: Pick<SpecialistRow, "spec">): string {
  return `${s.spec.arena}|${normalizeNicheLabel(s.spec.niche)}`;
}

/** 13 hires read as the niches they are: the same niche hired twice or three times is ONE
 *  lane, its working hire leading and the earlier copies folded under it. Ordered by the
 *  lead's hire state, then by label. */
export function foldNiches(specialists: readonly SpecialistRow[]): Niche[] {
  const map = new Map<string, SpecialistRow[]>();
  for (const s of specialists) {
    const k = nicheKeyOf(s);
    map.set(k, [...(map.get(k) ?? []), s]);
  }
  const out = [...map.entries()].map(([key, list]) => {
    const hires = [...list].sort((a, b) => hireRank(a) - hireRank(b) || (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a.id < b.id ? -1 : 1));
    return { key, arena: hires[0].spec.arena, label: hires[0].spec.niche, hires, lead: hires[0], earlier: hires.slice(1) };
  });
  return out.sort((a, b) => hireRank(a.lead) - hireRank(b.lead) || a.label.localeCompare(b.label));
}

/** The lane a gig runs in: the niche of the specialist that holds it (its latest
 *  attempt's, else the one it is routed or matched to); `NO_LANE` when none does. */
export const NO_LANE = "none";
export function laneOfGig(gig: Gig, latest: GigAttempt | null, nicheBySpecialist: ReadonlyMap<string, string>): string {
  const id = latest?.specialistId ?? gig.specialistId;
  return (id && nicheBySpecialist.get(id)) || NO_LANE;
}

export function nicheBySpecialistMap(niches: readonly Niche[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const n of niches) for (const h of n.hires) m.set(h.id, n.key);
  return m;
}

/** A niche's KPI: its hires' cells summed. The cells partition the sent attempts (each
 *  attempt belongs to exactly one specialist), so the sum is honest; the rate re-derives
 *  from the sums and stays null while nothing is resolved. Cost per accepted is kept only
 *  when every hire that won something reported it. */
export function nicheCell(niche: Pick<Niche, "hires">, kpi: Pick<GigKpi, "bySpecialist"> | null): GigKpiCell {
  let resolved = 0;
  let accepted = 0;
  let pending = 0;
  let costUnreported = 0;
  let spend = 0;
  let spendKnown = true;
  for (const h of niche.hires) {
    const c = kpi?.bySpecialist[h.id];
    if (!c) continue;
    resolved += c.resolved;
    accepted += c.accepted;
    pending += c.pending;
    costUnreported += c.costUnreported;
    if (c.accepted > 0) {
      if (c.costPerAcceptedUsd === null) spendKnown = false;
      else spend += c.costPerAcceptedUsd * c.accepted;
    }
  }
  return {
    resolved,
    accepted,
    pending,
    rate: resolved === 0 ? null : accepted / resolved,
    costPerAcceptedUsd: accepted > 0 && spendKnown ? spend / accepted : null,
    costUnreported,
    smallSample: resolved < 10,
  };
}

/** One specialist's whole attempt record, as GET /api/gigs/specialists `tallies` serves it
 *  (db/gigs-attempts.ts gigAttemptTallies). */
export type AttemptTally = { attempts: number; byStatus: Partial<Record<string, number>>; costUsd: number; costUnreported: number };

/** A niche's attempt record: its hires' tallies summed. */
export function nicheTally(niche: Pick<Niche, "hires">, tallies: Readonly<Record<string, AttemptTally>> | null): AttemptTally {
  const out: AttemptTally = { attempts: 0, byStatus: {}, costUsd: 0, costUnreported: 0 };
  for (const h of niche.hires) {
    const t = tallies?.[h.id];
    if (!t) continue;
    out.attempts += t.attempts;
    out.costUsd += t.costUsd;
    out.costUnreported += t.costUnreported;
    for (const [k, v] of Object.entries(t.byStatus)) out.byStatus[k] = (out.byStatus[k] ?? 0) + (v ?? 0);
  }
  return out;
}

/** The whole program's attempt record (Reception). */
export function programTally(tallies: Readonly<Record<string, AttemptTally>> | null): AttemptTally {
  return nicheTally({ hires: Object.keys(tallies ?? {}).map((id) => ({ id }) as SpecialistRow) }, tallies);
}

// ---------------------------------------------------------------------------
// Lanes: niches as rows, the lifecycle as columns
// ---------------------------------------------------------------------------

/** The line a gig walks. The two verdicts share one column: the judge's. */
export const LANE_STEPS = ["new", "suspect", "qualified", "dispatched", "drafted", "in_review", "sent", "verdict"] as const;
export type LaneStep = (typeof LANE_STEPS)[number];

/** The three ways off the line, counted apart: an exit, not a stage. */
export const EXIT_STATUSES = ["declined", "withdrawn", "expired"] as const satisfies readonly GigStatus[];

export function laneStepOf(status: GigStatus): LaneStep | null {
  if (status === "accepted" || status === "rejected") return "verdict";
  return (LANE_STEPS as readonly string[]).includes(status) ? (status as LaneStep) : null;
}

/** The steps whose next move is the operator's (washed coral on the lanes). */
export const YOUR_STEPS: ReadonlySet<LaneStep> = new Set<LaneStep>(["suspect", "drafted", "in_review"]);

export type LaneCell = { step: LaneStep; count: number; reached: boolean };
export type LaneRow = { key: string; cells: LaneCell[]; exit: number; total: number };

/** One row per niche plus the unrouted pool (`NO_LANE`, last). A zero cell is either
 *  "none here now" (the lane reached the step and moved on) or "never reached" - two
 *  facts that never render alike. */
export function laneRows(
  gigs: readonly Gig[],
  attemptsByGig: Readonly<Record<string, GigAttempt>>,
  niches: readonly Pick<Niche, "key">[],
  nicheBySpecialist: ReadonlyMap<string, string>
): LaneRow[] {
  const byLane = new Map<string, Gig[]>();
  for (const g of gigs) {
    const k = laneOfGig(g, attemptsByGig[g.id] ?? null, nicheBySpecialist);
    byLane.set(k, [...(byLane.get(k) ?? []), g]);
  }
  return [...niches.map((n) => n.key), NO_LANE].map((key) => {
    const mine = byLane.get(key) ?? [];
    const cells = LANE_STEPS.map((step) => {
      const count = mine.filter((g) => laneStepOf(g.status) === step).length;
      const reached =
        count > 0 ||
        (step === "verdict"
          ? mine.some((g) => g.status === "accepted" || g.status === "rejected")
          : reachedStep(mine, attemptsByGig, step as Exclude<LaneStep, "verdict">));
      return { step, count, reached };
    });
    const exit = mine.filter((g) => (EXIT_STATUSES as readonly string[]).includes(g.status)).length;
    return { key, cells, exit, total: mine.length };
  });
}

// ---------------------------------------------------------------------------
// The whole file: every gig, filtered and sorted
// ---------------------------------------------------------------------------

/** A status chip, or one of the two groups a lane cell opens: the judge's verdicts and
 *  the ways off the line. */
export type FileStatus = GigStatus | "all" | "verdict" | "exit";
export const FILE_SORTS = ["touched", "deadline", "fit", "reward"] as const;
export type FileSort = (typeof FILE_SORTS)[number];

export type FileFilter = {
  status: FileStatus;
  arena: GigArena | "all";
  /** A niche key (or NO_LANE) opened from Lanes; null = every lane. */
  lane: string | null;
  search: string;
  sort: FileSort;
  /** 1 = the sort's natural order, -1 reversed. */
  dir: 1 | -1;
};

export const EMPTY_FILE: FileFilter = { status: "all", arena: "all", lane: null, search: "", sort: "touched", dir: 1 };

export function statusMatches(filter: FileStatus, status: GigStatus): boolean {
  if (filter === "all") return true;
  if (filter === "verdict") return status === "accepted" || status === "rejected";
  if (filter === "exit") return (EXIT_STATUSES as readonly string[]).includes(status);
  return filter === status;
}

/** The file's rows. `touched` keeps the list's own order (most recently touched first).
 *  `deadline`: soonest open first, then the closed ones, then no deadline. `fit`: the scan's
 *  score, highest first, unscored last. `reward`: within ONE currency, largest first -
 *  currencies are grouped, never converted or compared, and an unstated reward sorts last.
 *  `dir` reverses the known part; absences stay at the end either way. */
export function fileRows(
  gigs: readonly Gig[],
  attemptsByGig: Readonly<Record<string, GigAttempt>>,
  filter: FileFilter,
  nicheBySpecialist: ReadonlyMap<string, string>,
  now: Date
): Gig[] {
  const rows = gigs.filter(
    (g) =>
      statusMatches(filter.status, g.status) &&
      (filter.arena === "all" || g.arena === filter.arena) &&
      (filter.lane === null || laneOfGig(g, attemptsByGig[g.id] ?? null, nicheBySpecialist) === filter.lane) &&
      matchesSearch(g, filter.search)
  );
  const dir = filter.dir;
  if (filter.sort === "deadline") {
    const key = (g: Gig) => {
      const d = deadlineView(g.deadlineAt, now);
      if (d.state === "none") return { band: 2, v: 0 };
      if (d.state === "passed") return { band: 1, v: -Date.parse(d.at) };
      return { band: 0, v: Date.parse(d.at) };
    };
    return rows
      .map((g) => ({ g, k: key(g) }))
      .sort((a, b) => a.k.band - b.k.band || (a.k.band === 0 ? (a.k.v - b.k.v) * dir : a.k.v - b.k.v))
      .map((x) => x.g);
  }
  if (filter.sort === "fit") {
    return [...rows].sort((a, b) => {
      const x = a.qualification?.score ?? null;
      const y = b.qualification?.score ?? null;
      if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
      return (y - x) * dir;
    });
  }
  if (filter.sort === "reward") {
    return [...rows].sort((a, b) => {
      const x = a.reward?.amount ?? null;
      const y = b.reward?.amount ?? null;
      if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
      const cx = a.reward?.currency ?? "";
      const cy = b.reward?.currency ?? "";
      if (cx !== cy) return cx < cy ? -1 : 1;
      return (y - x) * dir;
    });
  }
  return dir === 1 ? [...rows] : [...rows].reverse();
}

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
