import { ROLE_FAMILY_SLUGS, ROLE_FAMILY_LABELS } from "@/app/_lib/role-families";
import type { RoutingReasonCode } from "@/app/features/tools/profile/profileRoutingReasons";

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
  // Retired (archived) custom archetype: kept in the registry so profiles that route
  // to it still score, but hidden from the pickers. Absent/false on active archetypes.
  archived?: boolean;
};

// The baseline (shipped) archetypes: the ids with dedicated `choice.<id>` translations
// and detection rules. They are PROTECTED from archival — retiring them would strip the
// fairness shield / default routing the pipeline depends on. Single-sourced here (a
// client-safe module) so both the archetype-registry write layer and the management UI
// agree on which archetypes are built-in. Mirrors ARCHETYPE_CHOICES (minus "auto").
export const BUILT_IN_ARCHETYPE_IDS = ["bau", "student", "career_switcher"] as const;

// A candidate row for the archetype matrix (served by /api/profile/candidates) — a
// UNION of BOTH stores tagged with `source`: a saved CV analysis (slug → /history)
// or a saved v2 intake profile (id → the ?edit= editor deep link). `score` is the
// analysis total for an analysis and null for a profile (no match score — honest,
// never fabricated).
export type CandidateRow = {
  key: string;
  source: "profile" | "analysis";
  slug: string | null;
  id: string | null;
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
  // Machine-readable twin of `missing` (profile_cli.completeness_gaps): each unmet
  // checklist item keyed by its stable registry `check` id, biggest-gap-first.
  // Optional so a result persisted before this field existed still types — the
  // panel falls back to the raw `missing` labels then. The frontend localizes the
  // label by `check` and routes the clickable gap by `check`.
  missingGaps?: { check: string; label: string }[];
  // Machine-readable twin of `reasons` (registry.detect_detailed), same order: the
  // archetype router's explanation as {kind, params} codes the catalogs translate,
  // so the routing line is not English prose for a cs/de/fr reader. Optional for the
  // same reason missingGaps is — a result built before the field existed renders
  // through the legacy strings (profileRoutingReasons.ts owns that fallback).
  reasonCodes?: RoutingReasonCode[];
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
// Labels are overridden by enums.family at the render site (ProfileEditor); the
// label here is the non-i18n fallback. Slugs come from the canonical module.
export const ROLE_FAMILIES = ROLE_FAMILY_SLUGS.map((v) => ({ v, label: ROLE_FAMILY_LABELS[v] }));
export const EDU_LEVELS = ["unknown", "university", "bachelor", "master", "phd"];
export const SENIORITIES = ["junior", "medior", "senior", "lead"];
// EVIDENCE_KINDS / SKILL_LEVELS / PROVENANCE are GENERATED from the Python
// taxonomy (the single source of truth): EVIDENCE_KINDS + SKILL_LEVELS from
// pipeline/jobfit/profile.py, the user-selectable PROVENANCE from
// pipeline/jobfit/taxonomy.py's UI_PROVENANCE. To change the dropdown options,
// edit the Python lists and run `python -m pipeline.jobfit.codegen`; the build
// and `npm run schemas:check` gate fail if this file drifts from Python.
export { EVIDENCE_KINDS, SKILL_LEVELS, PROVENANCE } from "@/app/_lib/taxonomy.generated";
// No archetype-label re-export: the labels are catalog copy, resolved with
// useEnumLabel("archetypeLong" | "archetype", archetypeDisplayKey(id)). The raw
// ARCHETYPE_LABEL map stays internal to app/_lib/archetypes (it is the id vocabulary
// isKnownArchetype checks own-key membership against), and re-exporting it from a
// feature barrel is what put registry English on three recruiter surfaces.
