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
export type Offer = { recommended?: number; salaryMin?: number; salaryMax?: number; currency?: string; rationale?: string; subject?: string; body?: string; matchBasis?: number };

export const STAGES = ["Accepted", "Screened", "Interview", "Offer", "Hired"];
export const ARCHETYPE = {
  bau: { label: "Experienced", bg: "bg-steel" },
  student: { label: "Student", bg: "bg-coral" },
  career_switcher: { label: "Switcher", bg: "bg-moss" },
} as const;
export const styleFor = (a: string | null) => ARCHETYPE[(a as keyof typeof ARCHETYPE) ?? "bau"] ?? ARCHETYPE.bau;
