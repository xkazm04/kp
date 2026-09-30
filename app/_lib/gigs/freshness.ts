// Freshness: is a listing still takeable on its source? (docs/concepts/gig-sourcing-freshness.md,
// mechanisms B and C, built for Freelancer first.)
//
// A listing kp filed days ago may since have been awarded, frozen or deleted - and the
// training cycle drafted proposals for exactly those. Two doors ask the source again:
//
//   - refreshFreelancerGigStates: the scan's pass over this workspace's Freelancer gigs still
//     on the line, least recently checked first, up to GIG_FRESHNESS_MAX_PER_RUN per scan in
//     batches of FREELANCER_FRESHNESS_BATCH (one request each);
//   - checkGigStillOpen: dispatch's one-gig read, skipped while the last answer is younger
//     than GIG_FRESHNESS_TTL_MS.
//
// What an answer does:
//   - it is always recorded on the gig (setGigSourceState: state, sub-status, live bid count,
//     when) - the desk shows it, and `updated_at` is not touched;
//   - a `new` or `qualified` gig whose listing is no longer open moves to `expired` (the
//     ordinary CAS, so a gig dispatched meanwhile is left where it went);
//   - a gig further along (dispatched, drafted, in review) is NOT moved: work already done is
//     the operator's to judge (withdraw, decline, or send anyway where the source allows), and
//     the recorded state is what tells them. Dispatch refuses a new attempt on it.
//
// Honesty: a read that did not produce an answer (blocked, offline, outage, a changed shape)
// claims nothing about any gig - no state is written and nothing expires - and the summary
// says why. Absence counts only inside a successful answer: the API returns every project that
// still exists publicly, so an id it leaves out is `gone`.

import { listGigsForFreshness, setGigSourceState, transitionGig } from "../db/gigs";
import type { PoliteFetch } from "../jobseeker/fetch/politeFetch";
import { politeFetch } from "../jobseeker/fetch/politeFetch";
import { FREELANCER_FRESHNESS_BATCH, freelancerProjectIdOf, readFreelancerProjectStates } from "./adapters/freelancer";
import type { Gig, GigSourceState, GigStatus } from "./types";

/** The statuses whose listing is re-checked: still on the line, not yet sent or finished. */
export const GIG_FRESHNESS_STATUSES: readonly GigStatus[] = ["new", "suspect", "qualified", "dispatched", "drafted", "in_review"];
/** The statuses a closed listing expires (the same two the deadline sweep expires). */
export const GIG_FRESHNESS_EXPIRABLE: readonly GigStatus[] = ["new", "qualified"];
/** Gigs one scan re-checks at most: 4 requests at the batch size. */
export const GIG_FRESHNESS_MAX_PER_RUN = 200;
/** How old an answer dispatch trusts without asking again. */
export const GIG_FRESHNESS_TTL_MS = 6 * 60 * 60_000;

export type GigFreshnessDeps = {
  fetch: PoliteFetch;
  env: (name: string) => string | undefined;
  now: () => string;
  listGigsForFreshness: typeof listGigsForFreshness;
  setGigSourceState: typeof setGigSourceState;
  transitionGig: typeof transitionGig;
};

export function defaultGigFreshnessDeps(): GigFreshnessDeps {
  return {
    fetch: politeFetch,
    env: (name) => process.env[name],
    now: () => new Date().toISOString(),
    listGigsForFreshness,
    setGigSourceState,
    transitionGig,
  };
}

export type GigFreshnessSummary = {
  /** Gigs whose state was read and recorded. */
  checked: number;
  open: number;
  /** Awarded, frozen or otherwise closed on the source. */
  closed: number;
  /** No longer returned by the source (deleted, hidden, private). */
  gone: number;
  /** `new`/`qualified` gigs moved to `expired` because their listing is no longer open. */
  expired: number;
  /** Why the pass stopped early (the fetch outcome or `shape_changed`); null = it ran through. */
  failed: string | null;
};

function emptySummary(): GigFreshnessSummary {
  return { checked: 0, open: 0, closed: 0, gone: 0, expired: 0, failed: null };
}

/** Record one answer and expire the gig when it is still waiting and the listing is not open. */
function apply(workspaceId: string, gig: Gig, state: GigSourceState, deps: GigFreshnessDeps, summary: GigFreshnessSummary): void {
  deps.setGigSourceState(workspaceId, gig.id, state);
  summary.checked += 1;
  if (state.state === "open") summary.open += 1;
  else if (state.state === "gone") summary.gone += 1;
  else summary.closed += 1;
  if (state.state !== "open" && GIG_FRESHNESS_EXPIRABLE.includes(gig.status)) {
    const moved = deps.transitionGig(workspaceId, gig.id, { from: GIG_FRESHNESS_EXPIRABLE, to: "expired" });
    if (moved.ok) summary.expired += 1;
  }
}

/** Re-check this workspace's Freelancer gigs still on the line, least recently checked first. */
export async function refreshFreelancerGigStates(
  workspaceId: string,
  deps: GigFreshnessDeps = defaultGigFreshnessDeps(),
  opts: { limit?: number; signal?: AbortSignal } = {}
): Promise<GigFreshnessSummary> {
  const summary = emptySummary();
  const gigs = deps.listGigsForFreshness(workspaceId, {
    keyPrefix: "fl:",
    statuses: GIG_FRESHNESS_STATUSES,
    limit: opts.limit ?? GIG_FRESHNESS_MAX_PER_RUN,
  });
  const withIds = gigs
    .map((gig) => ({ gig, id: freelancerProjectIdOf(gig.externalKey) }))
    .filter((x): x is { gig: Gig; id: number } => x.id !== null && x.gig.sourceId !== null);
  for (let i = 0; i < withIds.length; i += FREELANCER_FRESHNESS_BATCH) {
    if (opts.signal?.aborted) {
      summary.failed = "aborted";
      break;
    }
    const batch = withIds.slice(i, i + FREELANCER_FRESHNESS_BATCH);
    const res = await readFreelancerProjectStates(
      batch.map((x) => x.id),
      { fetch: deps.fetch, env: deps.env, sourceId: batch[0].gig.sourceId as string, now: deps.now }
    );
    // A read without an answer stops the pass: a blocked or offline host is not asked again
    // this run, and no gig is claimed closed on the strength of a failure.
    if (!res.ok) {
      summary.failed = res.reason;
      break;
    }
    for (const { gig, id } of batch) {
      const state = res.states.get(id);
      if (state) apply(workspaceId, gig, state, deps, summary);
    }
  }
  return summary;
}

export type GigStillOpenResult =
  /** The source was not asked: not a Freelancer listing, or the last answer is fresh enough. */
  | { checked: false; state: GigSourceState | null }
  /** The source answered; `expired` = the gig moved to `expired` on this answer. */
  | { checked: true; state: GigSourceState; expired: boolean }
  /** The source could not answer (`reason` = the fetch outcome); nothing was recorded. */
  | { checked: false; state: GigSourceState | null; failed: string };

/** Dispatch's one-gig read: the recorded answer when it is younger than `ttlMs`, else one
 *  request. A closed listing on a `new`/`qualified` gig expires it here too. */
export async function checkGigStillOpen(
  workspaceId: string,
  gig: Gig,
  deps: GigFreshnessDeps = defaultGigFreshnessDeps(),
  ttlMs: number = GIG_FRESHNESS_TTL_MS
): Promise<GigStillOpenResult> {
  const id = freelancerProjectIdOf(gig.externalKey);
  if (id === null || gig.sourceId === null) return { checked: false, state: gig.sourceState };
  const nowMs = Date.parse(deps.now());
  const lastMs = gig.sourceState ? Date.parse(gig.sourceState.checkedAt) : Number.NaN;
  if (Number.isFinite(lastMs) && Number.isFinite(nowMs) && nowMs - lastMs < ttlMs) return { checked: false, state: gig.sourceState };
  const res = await readFreelancerProjectStates([id], { fetch: deps.fetch, env: deps.env, sourceId: gig.sourceId, now: deps.now });
  if (!res.ok) return { checked: false, state: gig.sourceState, failed: res.reason };
  const state = res.states.get(id);
  if (!state) return { checked: false, state: gig.sourceState, failed: "shape_changed" };
  const summary = emptySummary();
  apply(workspaceId, gig, state, deps, summary);
  return { checked: true, state, expired: summary.expired > 0 };
}
