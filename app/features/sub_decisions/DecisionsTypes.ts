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
export type Screening = { recommendation?: string; confidence?: number; rationale?: string; strengths?: string[]; redFlags?: string[] };
export type Scorecard = { recommendation?: string; summary?: string; ratings?: { competency: string; rating: number; evidence?: string }[] };
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
