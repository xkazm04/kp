export type AnalysisRow = {
  slug: string;
  candidate_label: string;
  role_family: string | null;
  seniority: string | null;
};
export type ProfileRow = {
  id: string;
  label: string;
  archetype: string | null;
  role_family: string | null;
  completeness: number | null;
};

export type MatchResult = {
  jobId: string;
  title: string;
  company?: string;
  location?: string;
  workMode?: string;
  seniority?: string;
  roleFamily?: string;
  salaryBand?: number[];
  total: number;
  skillsScore: number;
  careerScore: number;
  personalScore: number;
  confidenceLow: number;
  confidenceHigh: number;
  matchedSkills?: string[];
  matchedSkillProvenance?: Record<string, string>;
  missingSkills?: string[];
  isEntryEligible?: boolean;
  graduateFriendliness?: number;
};
export type MatchResponse = {
  candidate: {
    label?: string;
    seniority?: string;
    roleFamily?: string;
    archetype?: string;
    skills?: number;
    potentialScore?: number | null;
    assumptions?: string[];
  };
  meta: { evaluated?: number; koFiltered?: number; survivors?: number; returned?: number };
  matches: MatchResult[];
};
export type MatchRef = { profileId?: string; analysisSlug?: string };

export type Reasoning = { verdict: string; strengths: string[]; gaps: string[]; interviewProbes: string[] };
export type ReasoningState = { loading?: boolean; error?: string; source?: string; cached?: boolean; data?: Reasoning };

export const FAMILY_LABEL: Record<string, string> = {
  software_engineering: "Software",
  data_ai: "Data / AI",
  product_project: "Product / Project",
};
export const ARCHETYPE_LABEL: Record<string, string> = {
  bau: "Experienced",
  student: "Student / early-career",
  career_switcher: "Career-switcher",
};
export const EARLY_CAREER = new Set(["student", "career_switcher"]);

export function provLabel(p: string): { text: string; tone: string } {
  if (p === "professional") return { text: "prod", tone: "bg-stone-200 text-ink" };
  if (p === "internship") return { text: "intern", tone: "bg-blue-50 text-blue-700" };
  if (p === "self_declared") return { text: "self", tone: "bg-stone-100 text-steel" };
  if (p === "open_source") return { text: "OSS", tone: "bg-blue-50 text-blue-700" };
  if (p === "certification") return { text: "cert", tone: "bg-blue-50 text-blue-700" };
  return { text: "academic", tone: "bg-amber-50 text-amber-800" };
}
