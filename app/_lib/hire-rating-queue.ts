// challenge-r07 pipeline-api/B — the ONE fold behind "rated X of Y hires" on
// Analytics → Quality, and the queue of unrated hires it lists in place.
//
// Before this module the two halves of that line were counted over different
// populations: `hires` was today's terminal-column board entries, `rated` was every
// dev_outcomes row with a rating — dev-case-lane ratings and ex-hires included — so
// "X of Y" could overstate progress or exceed Y. Folding both over the same roster
// makes that unrepresentable: `rated` is the subset of `hires` whose own ref carries
// a rating, so rated <= hires and rated + unratedTotal === hires by construction.
//
// Pure (no DB, no React): the route hands it the roster (hire-roster.ts) and the
// latest outcome per ref (dev-outcomes.ts latestOutcomeByRefs), and the Quality line
// reads its three states off queueHeadline.
//
// Small-sample honesty: this module states COUNTS only, never a rate. The one
// threshold the line quotes is the caller's `minOutcomes` (MIN_CALIBRATION_OUTCOMES,
// the floor every calibration gate on that page already uses) — no second threshold
// is minted here.

/** How many unrated hires the GET carries. The total is always reported beside it,
 *  so a longer backlog reads "and N more", never as a shorter one. */
export const QUEUE_CAP = 25;

/** The 1..5 on-the-job scale the Quality queue offers. A client-safe copy of
 *  dev-outcomes' PERFORMANCE_MIN..PERFORMANCE_MAX (that module opens the store, so a
 *  client component cannot import it); outcomes-route.test.ts pins the two equal. */
export const HIRE_RATING_LEVELS = [1, 2, 3, 4, 5] as const;

/** One current hire, as the roster read returns it. `ref` is the dev_outcomes key
 *  (hireOutcomeRef), computed server-side; it never reaches the wire. */
export type HireRosterRow = {
  entryId: string;
  ref: string;
  candidateLabel: string;
  jobTitle: string | null;
  /** When the candidate reached the terminal column (stage_changed_at). */
  hiredAt: string | null;
};

/** The minimal slice of dev-outcomes' OutcomeSummary this fold reads. */
export type LatestHireOutcome = { outcome: string; performance: number | null };

/** A queue row names a person awaiting a judgement, never a judgement: no score, no
 *  rating value, no contact, no workspace id. */
export type UnratedHire = {
  entryId: string;
  candidateLabel: string;
  jobTitle: string | null;
  hiredAt: string | null;
};

export type HireRatingQueue = {
  hires: number;
  rated: number;
  unratedTotal: number;
  unrated: UnratedHire[];
};

/** A hire counts as rated only when its OWN ref's latest outcome is `hired` with a
 *  performance on file. A null performance, or an outcome that flipped away from
 *  hired, leaves it unrated — it never contributes a zero. */
function isRated(latest: LatestHireOutcome | undefined): boolean {
  return latest != null && latest.outcome === "hired" && latest.performance != null;
}

function hiredAtMs(row: HireRosterRow): number {
  const ms = row.hiredAt ? Date.parse(row.hiredAt) : Number.NaN;
  // A hire with no parseable stamp cannot be placed in time: it queues after every
  // dated one rather than pretending to be the oldest.
  return Number.isFinite(ms) ? ms : Number.POSITIVE_INFINITY;
}

/** Fold the roster against the latest outcome per ref.
 *
 *  Unrated hires queue OLDEST HIRE FIRST: the longest-serving hire is the one whose
 *  on-the-job outcome is knowable, so it is the rating worth asking for first. Ties
 *  break on entryId so the order is stable across reads. */
export function foldHireRatingQueue(
  hires: readonly HireRosterRow[],
  latestByRef: ReadonlyMap<string, LatestHireOutcome>
): HireRatingQueue {
  const pending: HireRosterRow[] = [];
  let rated = 0;
  for (const h of hires) {
    if (isRated(latestByRef.get(h.ref))) rated += 1;
    else pending.push(h);
  }
  pending.sort((a, b) => hiredAtMs(a) - hiredAtMs(b) || (a.entryId < b.entryId ? -1 : a.entryId > b.entryId ? 1 : 0));
  return {
    hires: hires.length,
    rated,
    unratedTotal: pending.length,
    unrated: pending.slice(0, QUEUE_CAP).map((h) => ({
      entryId: h.entryId,
      candidateLabel: h.candidateLabel,
      jobTitle: h.jobTitle,
      hiredAt: h.hiredAt,
    })),
  };
}

export type QueueHeadline =
  | { state: "none"; queueOpen: false }
  | { state: "ready"; rated: number; queueOpen: false }
  | { state: "pending"; rated: number; hires: number; remaining: number; queueOpen: boolean };

/** The Quality line's three states, off the one fold.
 *
 *  - `none`: no hires, so nothing to rate (and no queue).
 *  - `ready`: enough ratings for a curve to be judged; the queue is still offered,
 *    collapsed, because an unrated hire is still unrated.
 *  - `pending`: how many more ratings the curve needs, with the queue open. */
export function queueHeadline(counts: { hires: number; rated: number; minOutcomes: number }): QueueHeadline {
  if (counts.hires <= 0) return { state: "none", queueOpen: false };
  if (counts.rated >= counts.minOutcomes) return { state: "ready", rated: counts.rated, queueOpen: false };
  return {
    state: "pending",
    rated: counts.rated,
    hires: counts.hires,
    remaining: counts.minOutcomes - counts.rated,
    queueOpen: true,
  };
}
