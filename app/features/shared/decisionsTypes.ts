import type { InterviewRecommendation } from "@/app/_lib/interview-recommendation";
import type { MatchScoreProvenance } from "@/app/_lib/match-score";

// The interview scorecard shape is single-sourced — see app/_lib/interview-scorecard.ts.
// Re-exported here so Decisions consumers keep importing it from the local types barrel.
export type { Scorecard } from "@/app/_lib/interview-scorecard";

export type Entry = {
  id: string;
  candidateId: string | null;
  candidateLabel: string;
  archetype: string | null;
  roleFamily: string | null;
  jobId: string | null;
  jobTitle: string | null;
  stage: string;
  matchScore: number | null;
  status: string;
  approvalKind: string | null;
  approvalDetail: string | null;
  // Canonical match-score read path (REC-01) — stamped by GET /api/pipeline via
  // match-score-resolve.ts. Optional so snapshots from other producers (e.g. a
  // group-eval payload) degrade to the matchScore fallback in CandidateHead.
  canonicalScore?: number | null;
  scoreProvenance?: MatchScoreProvenance | null;
};

// `recommendation` is the canonical advance|hold|reject verdict — see
// app/_lib/interview-recommendation.ts. The stored approval_detail JSON always
// holds a coerced member (the Python coerce guarantees it), so the union is sound.
export type Screening = { recommendation?: InterviewRecommendation; confidence?: number; rationale?: string; strengths?: string[]; redFlags?: string[] };
// `matchBasis` (offer-v3 payloads) is the DRAFT-TIME fresh fit check that priced
// the salary — a genuinely different producer from the entry's canonical match
// score (see app/_lib/match-score.ts), so the card renders it under its own
// label instead of a second bare "match". Absent on cached/older drafts.
// `recommended` / `salaryMin` / `salaryMax` are explicitly NULLABLE and move as a
// set: draft_offer's fail-safe path (pipeline/jobfit/automation.py) emits all three
// as null when neither the posting nor the active market carries a salary band, so
// no figure is invented and a human prices the offer at the approval gate. Consumers
// must render that state honestly rather than coercing the nulls to 0.
export type Offer = { recommended?: number | null; salaryMin?: number | null; salaryMax?: number | null; currency?: string; rationale?: string; subject?: string; body?: string; matchBasis?: number };

// Direction 2 (queue-staleness) — the ONE staleness rule shared by every decision
// surface (the AI review cards + the wave preview rows), byte-identical to the
// library roster (JdCandidateList) and prep-pack (isPrepStale) derivation: a score
// computed strictly BEFORE the JD's last content edit reflects the earlier text.
// String compare is correct for ISO-8601 UTC. A never-edited JD (jdEditedAt null)
// or an unscored/snapshot entry (scoredAt null) is never stale — informs, never
// blocks. Pure so the client cards and the server wave path can't drift.
export function isScoreStale(scoredAt: string | null | undefined, jdEditedAt: string | null | undefined): boolean {
  return Boolean(jdEditedAt) && Boolean(scoredAt) && (scoredAt as string) < (jdEditedAt as string);
}

// Confidence-band cutoffs for the AI's numeric self-confidence (0-100) in its OWN
// screening verdict — the compact band on each AI review card (decision-io-diet). The
// tone tracks wrong-click risk: at or above HIGH the advance/reject is safe (moss); at or
// above MEDIUM it warrants a second look (amber); below MEDIUM it is the low-confidence
// click the band exists to flag (coral). Single home so the card and any future consumer
// (wave preview, analytics) can't drift apart on where the lines sit.
export const SCREENING_CONFIDENCE_BAND = { high: 70, medium: 40 } as const;

export const STAGES = ["Accepted", "Screened", "Interview", "Offer", "Hired"];
export const ARCHETYPE = {
  bau: { label: "Experienced", bg: "bg-steel" },
  student: { label: "Student", bg: "bg-coral" },
  career_switcher: { label: "Switcher", bg: "bg-moss" },
} as const;
export const styleFor = (a: string | null) => ARCHETYPE[(a as keyof typeof ARCHETYPE) ?? "bau"] ?? ARCHETYPE.bau;
