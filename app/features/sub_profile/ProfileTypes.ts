// `_id` is a stable CLIENT-ONLY key for React list rendering (idea-row-identity): it is
// never persisted — ProfileEditor.build() maps each row to the payload field-by-field, so
// _id can't leak into profiles.payload_json. Keying on it (not the array index) keeps focus,
// text selection and IME state attached to the right row when a middle row is removed.
export type SkillRow = { skill: string; level: string; provenance: string; _id?: string };

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
export type EvidenceRow = { kind: string; title: string; text: string; skills: string; link: string; _id?: string };

// The build/edit API response the editor consumes: the full profile_cli output
// (/api/profile spreads ...data onto the response) plus the persistence outcome.
// Derived from the one CLI contract (ProfileCliOutput) so a field added or
// renamed Python-side can't silently drift from this client-side view.
export type BuildResult = ProfileCliOutput & { saved?: { id: string } | null };

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

// The full profile_cli stdout contract (pipeline/jobfit/profile_cli.py): the
// normalized profile payload plus the archetype router + completeness scoring.
// SINGLE SOURCE OF TRUTH for that JSON shape — /api/profile types JSON.parse
// against it, persistFieldsFrom reads it, and BuildResult is derived from it. A
// field added or renamed on the Python side therefore surfaces as a TS error at
// these seams instead of leaking through untyped via ...data / unchecked casts.
export type ProfileCliOutput = {
  profile: ProfilePayload;
  archetype: string;
  confidence: number;
  reasons: string[];
  completeness: number;
  missing: string[];
};

// BASELINE archetype choices for the editor's routing control: the ids with
// dedicated `choice.<id>` translation keys. The live segment list is built from
// the /api/archetypes registry in ProfileEditor (so recruiter-created archetypes
// are routable from the editor too); this list is the translated-label lookup for
// the known ids and the fallback while the registry hasn't loaded. `label` is the
// English source text mirrored by the catalogs, kept for reference only.
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
// EVIDENCE_KINDS / SKILL_LEVELS / PROVENANCE are GENERATED from the Python
// taxonomy (the single source of truth): EVIDENCE_KINDS + SKILL_LEVELS from
// pipeline/jobfit/profile.py, the user-selectable PROVENANCE from
// pipeline/jobfit/taxonomy.py's UI_PROVENANCE. To change the dropdown options,
// edit the Python lists and run `python -m pipeline.jobfit.codegen`; the build
// and `npm run schemas:check` gate fail if this file drifts from Python.
export { EVIDENCE_KINDS, SKILL_LEVELS, PROVENANCE } from "@/app/_lib/taxonomy.generated";
// Single source of truth for archetype labels (app/_lib/archetypes).
export { ARCHETYPE_LABEL } from "@/app/_lib/archetypes";
