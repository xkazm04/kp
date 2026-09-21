"use client";

// The role ranking every candidate surface on the pipeline reads: the full match
// breakdown for every candidate on ONE job, in ONE request.
//
// GET /api/jobs/[id]/candidates ranks the workspace pool against the job and
// returns each candidate's MatchResultView (total, fitTier, confidence, the five
// scoreBreakdown dimensions, matched/missing/unproven skills). The route spawns the
// Python ranker (seconds, rate-limited 30/10min), so the answer is held in a
// MODULE-level store keyed by job: the Orchard overlay and the candidate modal on
// top of it read the same slot, and an in-flight request is shared rather than
// repeated. A slot is fresh for 10 minutes; a failed one is retried after 30s.
//
// A lane with no jobId (a title-only lane) has no ranking to fetch: the map stays
// empty and cards fall back to the Entry's canonical/snapshot score.

import { useEffect, useSyncExternalStore } from "react";
import type { MatchResultView } from "@/app/features/shared/matchTypes";

type CandRow = { candidateId?: string; result?: MatchResultView | null };
type Slot = { map: ReadonlyMap<string, MatchResultView>; failed: boolean; at: number };

const EMPTY: ReadonlyMap<string, MatchResultView> = new Map();
const FRESH_MS = 10 * 60_000;
const RETRY_MS = 30_000;

const slots = new Map<string, Slot>();
const inflight = new Set<string>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function ensureRanking(jobId: string): void {
  const slot = slots.get(jobId);
  const ttl = slot?.failed ? RETRY_MS : FRESH_MS;
  if (inflight.has(jobId) || (slot && Date.now() - slot.at < ttl)) return;
  inflight.add(jobId);
  fetch(`/api/jobs/${encodeURIComponent(jobId)}/candidates`)
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
    .then((p: { candidates?: CandRow[] }) => {
      const map = new Map<string, MatchResultView>();
      for (const row of p.candidates ?? []) {
        if (row.candidateId && row.result) map.set(row.candidateId, row.result);
      }
      slots.set(jobId, { map, failed: false, at: Date.now() });
    })
    .catch(() => {
      // Keep whatever an earlier success held: a blip must not blank the bars.
      slots.set(jobId, { map: slot?.map ?? EMPTY, failed: true, at: Date.now() });
    })
    .finally(() => {
      inflight.delete(jobId);
      for (const listener of listeners) listener();
    });
}

export function useCellMatchData(jobId: string | null): {
  matchByCandidate: ReadonlyMap<string, MatchResultView>;
  matchLoading: boolean;
  /** A flag, never the server's words — consumers render their own localized line. */
  matchError: "unavailable" | null;
} {
  const slot = useSyncExternalStore(
    subscribe,
    () => (jobId ? slots.get(jobId) : undefined),
    () => undefined,
  );
  useEffect(() => {
    if (jobId) ensureRanking(jobId);
  }, [jobId]);
  return {
    matchByCandidate: slot?.map ?? EMPTY,
    matchLoading: jobId !== null && slot === undefined,
    matchError: slot?.failed ? "unavailable" : null,
  };
}
