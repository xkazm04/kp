export type JobRequirement = { skill: string; termId?: string | null; kind: string; hardness: string };
export type JobEntryProfile = {
  isEntryEligible: boolean;
  graduateFriendliness: number;
  reinterpretedMusts: string[];
  trainableGaps: string[];
  rationale?: string;
};
export type Job = {
  id: string;
  title: string;
  company?: string;
  location?: string;
  workMode?: string;
  employmentType?: string | null;
  seniority?: string;
  roleFamily?: string;
  languages?: string[];
  minYearsExperience?: number | null;
  minEducation?: string | null;
  description?: string;
  requirements?: JobRequirement[];
  detectedSkills?: string[];
  salaryBand?: number[];
  entryProfile?: JobEntryProfile | null;
};
export type Stats = {
  total: number;
  entryEligible: number;
  byRoleFamily: Record<string, number>;
  bySeniority: Record<string, number>;
  byWorkMode: Record<string, number>;
};

export type ConfidenceLevel = "tight" | "moderate" | "wide";
/** Score band + the human reasons behind its width (matching.py `Confidence`). */
export type Confidence = {
  low: number;
  high: number;
  level: ConfidenceLevel;
  drivers: string[];
};

export type CandResult = {
  total: number;
  fitTier?: "strong" | "promising" | "partial";
  tone?: string;
  confidence: Confidence;
  matchedSkills?: string[];
  matchedSkillProvenance?: Record<string, string>;
  missingSkills?: string[];
};
export type CandRow = {
  candidateId: string;
  label: string;
  archetype: string;
  seniority: string;
  potentialScore?: number | null;
  koPassed: boolean;
  koReasons: string[];
  assumptions: string[];
  result: CandResult;
};

export const FAMILY_LABEL: Record<string, string> = {
  software_engineering: "Software",
  data_ai: "Data / AI",
  product_project: "Product / Project",
};
export const FAMILIES = ["software_engineering", "data_ai", "product_project"];
export const SENIORITIES = ["junior", "medior", "senior", "lead"];
export const MODES = ["remote", "hybrid", "onsite"];

// Archetype taxonomy + the early-career fairness predicate live in one canonical
// module (app/_lib/archetypes) so the protected set is never hand-copied.
export { ARCHETYPE_BADGE, isEarlyCareer } from "@/app/_lib/archetypes";

export function provLabel(p: string): { text: string; tone: string } {
  if (p === "professional") return { text: "prod", tone: "bg-stone-200 text-ink" };
  if (p === "internship") return { text: "intern", tone: "bg-blue-50 text-blue-700" };
  if (p === "self_declared") return { text: "self", tone: "bg-stone-100 text-steel" };
  if (p === "open_source") return { text: "OSS", tone: "bg-blue-50 text-blue-700" };
  if (p === "certification") return { text: "cert", tone: "bg-blue-50 text-blue-700" };
  return { text: "academic", tone: "bg-amber-50 text-amber-800" }; // thesis/project/coursework
}

export function formatBand(band?: number[]): string {
  if (!band || band.length < 2) return "—";
  return `${Math.round(band[0] / 1000)}–${Math.round(band[1] / 1000)}k`;
}
