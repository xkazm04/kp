export type SkillRow = { skill: string; level: string; provenance: string };
export type EvidenceRow = { kind: string; title: string; text: string; skills: string; link: string };

export type BuildResult = {
  archetype: string;
  confidence: number;
  reasons: string[];
  completeness: number;
  missing: string[];
  saved?: { id: string } | null;
};

export type ProfileRow = {
  id: string;
  label: string;
  archetype: string | null;
  role_family: string | null;
  completeness: number | null;
};

export const ARCHETYPE_CHOICES = [
  { v: "auto", label: "Auto-detect" },
  { v: "bau", label: "Experienced" },
  { v: "student", label: "Student / early-career" },
  { v: "career_switcher", label: "Career-switcher" },
];
export const ROLE_FAMILIES = [
  { v: "software_engineering", label: "Software" },
  { v: "data_ai", label: "Data / AI" },
  { v: "product_project", label: "Product / Project" },
];
export const EDU_LEVELS = ["unknown", "university", "bachelor", "master", "phd"];
export const SENIORITIES = ["junior", "medior", "senior", "lead"];
export const SKILL_LEVELS = ["foundational", "working", "strong"];
export const PROVENANCE = [
  "self_declared",
  "coursework",
  "academic_project",
  "thesis",
  "personal_project",
  "open_source",
  "internship",
  "professional",
  "certification",
  "extracurricular",
];
export const EVIDENCE_KINDS = [
  "project",
  "thesis",
  "internship",
  "course",
  "extracurricular",
  "certification",
  "job",
  "other",
];
export const ARCHETYPE_LABEL: Record<string, string> = {
  bau: "Experienced",
  student: "Student / early-career",
  career_switcher: "Career-switcher",
};
