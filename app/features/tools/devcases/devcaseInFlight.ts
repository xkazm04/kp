// Close sees who is mid-case (challenge-r06 devcase-session-api/B).
//
// The postings GET carries each posting's in-flight aggregate (counts only). This module
// folds it per case, the way DevLifecycleSection already folds submissions, and decides
// whether the close confirm has to name the attempts the close would cut off. Pure, so
// node:test drives it without a DOM.
import type { Posting, PostingInFlight } from "./DevTypes";

export const NO_IN_FLIGHT: PostingInFlight = Object.freeze({ live: 0, idle: 0, oldestLiveStartedAt: null }) as PostingInFlight;

function earlier(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return Date.parse(b) < Date.parse(a) ? b : a;
}

/** caseId -> the in-flight aggregate summed across that case's postings. A posting with no
 *  case, or with no aggregate (an older server), contributes nothing. */
export function inFlightByCase(postings: ReadonlyArray<Pick<Posting, "caseId" | "inFlight">>): Map<string, PostingInFlight> {
  const out = new Map<string, PostingInFlight>();
  for (const p of postings) {
    if (!p.caseId || !p.inFlight) continue;
    const prev = out.get(p.caseId) ?? NO_IN_FLIGHT;
    out.set(p.caseId, {
      live: prev.live + p.inFlight.live,
      idle: prev.idle + p.inFlight.idle,
      oldestLiveStartedAt: earlier(prev.oldestLiveStartedAt, p.inFlight.oldestLiveStartedAt),
    });
  }
  return out;
}

export type CloseWarning = { key: "lifecycle.closeInFlight"; values: { count: number; minutes: number } };

/** The close confirm's extra line: only LIVE attempts raise it (an idle one is an
 *  abandoned tab the close costs nothing). `minutes` is how long the longest live attempt
 *  has run, never NaN. */
export function closeWarning(agg: PostingInFlight | null | undefined, nowMs: number): CloseWarning | null {
  if (!agg || agg.live <= 0) return null;
  const started = agg.oldestLiveStartedAt ? Date.parse(agg.oldestLiveStartedAt) : NaN;
  const minutes = Number.isFinite(started) ? Math.max(0, Math.round((nowMs - started) / 60_000)) : 0;
  return { key: "lifecycle.closeInFlight", values: { count: agg.live, minutes } };
}
