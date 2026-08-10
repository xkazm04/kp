// Pure client-side peer comparison for the Decisions surfaces: rank a card's
// candidate among the OTHER active candidates on the same job, from the entries
// the tab already holds (GET /api/pipeline stamps canonicalScore — no extra
// fetch). Pure module (no JSX/hooks) so it's unit-testable under node:test.
import type { Entry } from "@/app/features/shared/decisionsTypes";

export type PeerScore = {
  entryId: string;
  label: string;
  stage: string;
  score: number | null;
};

// The peer-context facts served by GET /api/decisions/peer-context, keyed jobId
// → entryId. Mirrors the route's payload types (kept here so client code doesn't
// import from a route module).
export type PeerEntryFacts = {
  salary: { minimum: number; maximum: number; midpoint: number; currency: string } | null;
  // basis: "verified" = the analysis' own per-JD jobFit; "declared" = candidate's
  // declared skills ∩ role requirements (the honest corpus-job fallback).
  skills: { matched: number; missing: number; basis: "verified" | "declared" } | null;
};
export type JobPeerContext = { salaryBand: number[] | null; byEntry: Record<string, PeerEntryFacts> };
export type PeerContextMap = Record<string, JobPeerContext>;

/** The score of record for peer ranking — the same precedence the card header
 *  renders (canonicalScore, else the snapshot matchScore), so the rank can never
 *  disagree with the number printed beside it. */
export function peerScoreOf(e: Pick<Entry, "canonicalScore" | "matchScore">): number | null {
  return e.canonicalScore ?? e.matchScore ?? null;
}

/** All active candidates on the same job as `entry` (including `entry` itself),
 *  as peer rows. Empty when the entry has no job (nothing comparable). */
export function peersForEntry(entries: Entry[], entry: Entry): PeerScore[] {
  if (!entry.jobId) return [];
  return entries
    .filter((e) => e.status === "active" && e.jobId === entry.jobId)
    .map((e) => ({ entryId: e.id, label: e.candidateLabel, stage: e.stage, score: peerScoreOf(e) }));
}

export type PeerStanding = {
  /** 1-based rank among SCORED peers (ties share the better rank). */
  rank: number;
  /** How many peers (incl. this candidate) carry a score. */
  of: number;
  /** Best / median scores across the scored peer set. */
  best: number;
  median: number;
  /** This candidate's score minus the best OTHER candidate's score (0 when
   *  leading alone; positive margin when leading, negative gap when trailing). */
  deltaBest: number;
  /** Peers with no score at all — reported so the UI can disclose the blind spot
   *  instead of silently ranking over them. */
  unscored: number;
};

/** Rank `entryId` inside its peer set. Null when the candidate has no score or
 *  fewer than two peers are scored — a rank of "1 of 1" is noise, not signal. */
export function peerStanding(peers: PeerScore[], entryId: string): PeerStanding | null {
  const scored = peers.filter((p): p is PeerScore & { score: number } => p.score != null);
  const self = scored.find((p) => p.entryId === entryId);
  if (!self || scored.length < 2) return null;
  const sorted = [...scored].sort((a, b) => b.score - a.score);
  const rank = sorted.findIndex((p) => p.score === self.score) + 1;
  const best = sorted[0].score;
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 1 ? sorted[mid].score : Math.round((sorted[mid - 1].score + sorted[mid].score) / 2);
  const bestOther = sorted.find((p) => p.entryId !== self.entryId)?.score ?? self.score;
  return {
    rank,
    of: sorted.length,
    best,
    median,
    deltaBest: self.score - bestOther,
    unscored: peers.length - scored.length,
  };
}
