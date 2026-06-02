export type SkillRow = { skill: string; level: string; provenance: string };

// Client-side mirror of an archetype registry row (served by /api/archetypes).
// Kept separate from the server helper (app/_lib/archetype-registry.ts), which
// imports node:fs and must never be pulled into a client bundle.
export type ArchetypeChecklistItem = { check: string; weight: number; label: string };
export type ArchetypeDef = {
  id: string;
  label: string;
  badge: string;
  pythonLabel?: string;
  applyLabel?: string;
  fairnessProtected: boolean;
  scoringModel: string;
  weights: { skills: number; career: number; personal: number };
  dimensionLabels: { skills: string; career: string; personal: string };
  checklist: ArchetypeChecklistItem[];
};

// A candidate row for the archetype matrix (served by /api/profile/candidates) —
// a saved CV analysis tagged with its routed archetype; the slug opens its full
// Analyze output at /history/<slug>.
export type CandidateRow = {
  slug: string;
  name: string;
  role: string | null;
  seniority: string | null;
  score: number | null;
  archetype: string;
};
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
  created_at?: string;
};

// The normalized profile payload (profile_cli output, by_alias camelCase) as it
// is persisted in `profiles.payload_json`. Used to hydrate the editor on
// edit/duplicate and to read fields back without re-deriving them.
export type ProfilePayload = {
  displayName?: string;
  roleFamily?: string;
  educationLevel?: string;
  educationDetail?: string;
  languages?: string[];
  location?: string;
  availability?: string;
  aspirations?: string[];
  yearsExperience?: number;
  seniority?: string;
  archetype?: string;
  skillClaims?: { skill?: string; level?: string; provenance?: string }[];
  evidence?: { kind?: string; title?: string; text?: string; skills?: string[]; link?: string }[];
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
// Single source of truth for archetype labels (app/_lib/archetypes).
export { ARCHETYPE_LABEL } from "@/app/_lib/archetypes";
