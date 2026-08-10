// Data-fetching for DecisionsAnalysisSummaryModal: the candidate's profile
// payload (skills/aspirations/education) and the full match breakdown for the
// (candidate, role) pair, plus the derived skill lists the modal renders.
// Split out of the modal component so its JSX stays under the 200-line cap.
import { useEffect, useState } from "react";
import type { MatchResultView } from "@/app/features/shared/matchTypes";
import type { Entry } from "@/app/features/shared/decisionsTypes";

type SkillClaim = { skill?: string; level?: string; provenance?: string };
export type AnalysisPayload = {
  seniority?: string;
  archetype?: string;
  roleFamily?: string;
  yearsExperience?: number;
  educationLevel?: string;
  educationDetail?: string;
  location?: string;
  languages?: string[];
  aspirations?: string[];
  skillClaims?: SkillClaim[];
};

// The same full breakdown the recruiter ranker emits (matching.score_job), for
// this one candidate against this role — surfaced so the single-candidate
// decision carries the same evidence the comparison matrix does. The shared
// recruiter result view (MatchResultView), single-sourced from MatchTypes.
export type MatchView = MatchResultView;
type CandRow = { candidateId: string; label?: string; result: MatchView };
// A ranked peer on the same role — the rest of the rows the candidates fetch
// already returns (the modal used to discard them). Same producer as `match`,
// so a peer's total and this candidate's total are always comparable.
export type PeerRow = { candidateId: string; label: string; result: MatchView };

export function useAnalysisSummaryData(entry: Entry) {
  const [payload, setPayload] = useState<AnalysisPayload | null>(null);
  const [loading, setLoading] = useState(Boolean(entry.candidateId));
  const [match, setMatch] = useState<MatchView | null>(null);
  const [peers, setPeers] = useState<PeerRow[]>([]);
  const [matchLoading, setMatchLoading] = useState(Boolean(entry.candidateId && entry.jobId));

  useEffect(() => {
    if (!entry.candidateId) return;
    let alive = true;
    fetch(`/api/profile?id=${encodeURIComponent(entry.candidateId)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error())))
      .then((p) => alive && setPayload((p.profile?.payload as AnalysisPayload) ?? null))
      .catch(() => alive && setPayload(null))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [entry.candidateId]);

  // Full score breakdown for this (candidate, role) pair — the same recruiter
  // ranking the group comparison uses, filtered to this candidate. Best-effort:
  // a failure just hides the breakdown section, the profile facts stay.
  useEffect(() => {
    if (!entry.candidateId || !entry.jobId) return;
    let alive = true;
    fetch(`/api/jobs/${encodeURIComponent(entry.jobId)}/candidates`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error())))
      .then((p) => {
        if (!alive) return;
        const rows = (p.candidates as CandRow[] | undefined) ?? [];
        const row = rows.find((c) => c.candidateId === entry.candidateId);
        setMatch(row?.result ?? null);
        // Every OTHER ranked candidate on this role, for the peer-comparison
        // variants. Rows without a result/label carry no comparable signal.
        setPeers(
          rows
            .filter((c) => c.candidateId !== entry.candidateId && c.result && typeof c.label === "string")
            .map((c) => ({ candidateId: c.candidateId, label: c.label as string, result: c.result }))
        );
      })
      .catch(() => alive && setMatch(null))
      .finally(() => alive && setMatchLoading(false));
    return () => {
      alive = false;
    };
  }, [entry.candidateId, entry.jobId]);

  const skills = (payload?.skillClaims ?? []).map((c) => c.skill).filter(Boolean).slice(0, 12) as string[];
  const matchProv = match?.matchedSkillProvenance ?? {};
  // The claimed-but-unproven bucket (round 7) — named required skills scored above 0
  // but below the match threshold, so neither matched nor missing. The reason axis
  // draws the honest distinction the recruiter needs at the click: "adjacency" is a
  // near-miss specialist (has a sibling skill), "provenance" is an unsubstantiated
  // claim, "both" is both. Absent → the section doesn't render.
  const unproven = match?.unprovenSkills ?? [];
  const unprovenReason = match?.unprovenSkillReason ?? {};
  const unprovenStrength = match?.unprovenSkillStrength ?? {};
  // Map the reason code to its honest label key; an unknown/absent code degrades to
  // the neutral "claimed" label rather than asserting a distinction we can't back.
  const unprovenLabelKey = (reason: string | undefined): "unprovenAdjacency" | "unprovenProvenance" | "unprovenBoth" | "unprovenClaimed" =>
    reason === "adjacency" ? "unprovenAdjacency" : reason === "provenance" ? "unprovenProvenance" : reason === "both" ? "unprovenBoth" : "unprovenClaimed";

  return { payload, loading, match, peers, matchLoading, skills, matchProv, unproven, unprovenReason, unprovenStrength, unprovenLabelKey };
}
