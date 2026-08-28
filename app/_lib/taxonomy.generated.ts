// AUTO-GENERATED — DO NOT EDIT.
// Source of truth: pipeline/jobfit/profile.py (EVIDENCE_KINDS, SKILL_LEVELS),
// pipeline/jobfit/taxonomy.py (UI_PROVENANCE) and
// pipeline/jobfit/devcase/models.py (the devcase timebox bounds).
// Regenerate with: python -m pipeline.jobfit.codegen

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

export const SKILL_LEVELS = [
  "foundational",
  "working",
  "strong",
];

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

// The cap on a candidate's unpaid work, in hours, and the floor that keeps a
// degenerate 0 from rendering as "~0h". Every writer clamps to these.
export const DEVCASE_MAX_TIMEBOX_HOURS = 2.0;
export const DEVCASE_MIN_TIMEBOX_HOURS = 0.5;
