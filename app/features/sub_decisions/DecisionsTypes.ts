import type { InterviewRecommendation } from "@/app/_lib/interview-recommendation";

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
};

export type Reasoning = { verdict: string; strengths: string[]; gaps: string[]; interviewProbes: string[] };
// `recommendation` is the canonical advance|hold|reject verdict — see
// app/_lib/interview-recommendation.ts. The stored approval_detail JSON always
// holds a coerced member (the Python coerce guarantees it), so the union is sound.
export type Screening = { recommendation?: InterviewRecommendation; confidence?: number; rationale?: string; strengths?: string[]; redFlags?: string[] };
export type Offer = { recommended?: number; salaryMin?: number; salaryMax?: number; currency?: string; rationale?: string; subject?: string; body?: string };

export const STAGES = ["Accepted", "Screened", "Interview", "Offer", "Hired"];
export const ARCHETYPE = {
  bau: { label: "Experienced", bg: "bg-steel" },
  student: { label: "Student", bg: "bg-coral" },
  career_switcher: { label: "Switcher", bg: "bg-moss" },
} as const;
export const styleFor = (a: string | null) => ARCHETYPE[(a as keyof typeof ARCHETYPE) ?? "bau"] ?? ARCHETYPE.bau;

export const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];
export const TIMES = ["09:00", "10:30", "11:00", "14:00", "15:30"];
