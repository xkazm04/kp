import type { Job } from "./JobsTypes.ts";

// After ingesting an ad, JobsTab latches the new job's id so the render-phase can
// auto-open its posting once the refreshed corpus contains it. The latch also
// remembers the jobs-array reference it was created against (`sawJobs`) so we can
// tell "the list hasn't refreshed yet" (still the same array) from "the refresh
// landed" (a new array) — the whole point being to consume EXACTLY ONE post-latch
// refresh and never leave the latch armed.
//
// bug-ui-scan-2026-07-09 (job-postings-lifecycle #5): the old latch was a bare
// `pendingOpenId` string cleared ONLY on a match. `/api/jobs/ingest` inserts the ad
// as a DRAFT, so with the "open only" filter on the reloaded list excluded it, the
// id never matched, the modal never opened, and the latch stayed armed — so a LATER
// ingest (or any list change producing that id) could auto-open a modal out of
// nowhere. This resolver bounds the latch to a single refresh: on the refreshed
// list it either opens the match or clears (a "miss"), never staying armed.
export type IngestLatch = { id: string; sawJobs: Job[] | null };

export type LatchResolution =
  | { kind: "open"; job: Job } // the refreshed list contains the ingested job — open it
  | { kind: "clear" } // the refreshed list arrived without it — drop the latch (bounded)
  | { kind: "wait" }; // no latch, corpus not loaded, or the refresh hasn't landed yet

// Pure: decide what to do with an armed ingest latch given the current corpus.
// `jobs === latch.sawJobs` means the list is still the pre-ingest array (the
// debounced refetch hasn't returned) — WAIT, so we don't prematurely clear before
// the just-ingested draft has a chance to appear. Once a new array lands we resolve
// exactly once: open on a hit, clear on a miss.
export function resolveIngestLatch(
  jobs: Job[] | null,
  latch: IngestLatch | null
): LatchResolution {
  if (!latch || !jobs) return { kind: "wait" };
  if (jobs === latch.sawJobs) return { kind: "wait" };
  const match = jobs.find((j) => j.id === latch.id);
  return match ? { kind: "open", job: match } : { kind: "clear" };
}

// Whether an ingest should clear the "open only" filter so the just-ingested draft
// is reachable in the refreshed list (ingest always inserts a draft, which the
// filter hides). Kept pure + tiny so the intent is pinned by a test.
export function ingestNeedsOpenFilterCleared(openOnly: boolean): boolean {
  return openOnly;
}
