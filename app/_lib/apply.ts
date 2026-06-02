import archetypeRegistry from "@/pipeline/jobfit/archetypes.json";
import type { JobRecord } from "./db";
import { buildIntakeProfile, type ApplyAnswers } from "./apply-intake";

// Conversational, formless apply: a short chat that captures the candidate and
// runs job-derived knockout (KO) questions before they enter the pipeline.

// The locale default and the bilingual years parser live in the registry-free
// `apply-intake` module so they can be unit-tested directly; re-exported here so
// the apply flow keeps a single public surface.
export { DEFAULT_APPLY_LANGUAGES, parseYearsExperience } from "./apply-intake";

export type ApplyStep =
  | { id: string; type: "text"; prompt: string; placeholder?: string }
  | { id: string; type: "ko"; prompt: string }
  | { id: string; type: "choice"; prompt: string; options: { value: string; label: string }[] };

/** The KO step ids — a "no" on any of these declines the application. */
export const KO_STEP_IDS = ["ko_auth", "ko_mode", "ko_lang"] as const;

// Candidate-facing archetype self-declaration, sourced from the shared registry
// (only archetypes with an `applyLabel` are offered). A real self-declaration
// lifts archetype detection from heuristic-only (~0.4) to declared (0.9), so an
// early-career applicant is fairly routed — and fairness-shielded — from the
// first pipeline stage instead of being mistaken for an experienced hire.
type RegistryArchetype = { id: string; applyLabel?: string };
const ALL_ARCHETYPES = archetypeRegistry.archetypes as RegistryArchetype[];
const APPLY_ARCHETYPE_OPTIONS = ALL_ARCHETYPES.filter((a) => a.applyLabel).map((a) => ({
  value: a.id,
  label: a.applyLabel as string,
}));
const ARCHETYPE_IDS = new Set(ALL_ARCHETYPES.map((a) => a.id));

export function buildApplyScript(job: JobRecord): ApplyStep[] {
  const steps: ApplyStep[] = [
    {
      id: "name",
      type: "text",
      prompt: `Hi! Let's get you applied for ${job.title}${job.company ? ` at ${job.company}` : ""}. What's your name?`,
      placeholder: "Your name",
    },
    {
      id: "experience",
      type: "text",
      prompt: "Nice to meet you. In a sentence or two, what's your most relevant recent experience for this role?",
      placeholder: "e.g. 3 years building Node.js APIs…",
    },
    {
      id: "skills",
      type: "text",
      prompt: "Which skills should we highlight for this role? (comma-separated)",
      placeholder: "e.g. React, Node.js, SQL",
    },
  ];

  if (APPLY_ARCHETYPE_OPTIONS.length > 1) {
    steps.push({
      id: "archetype",
      type: "choice",
      prompt: "Which best describes you right now? It helps us assess you fairly.",
      options: APPLY_ARCHETYPE_OPTIONS,
    });
  }

  steps.push({
    id: "ko_auth",
    type: "ko",
    prompt: `Are you legally authorized to work in ${job.location || "the country for this role"}?`,
  });

  if (job.workMode && job.workMode.toLowerCase() !== "remote") {
    steps.push({
      id: "ko_mode",
      type: "ko",
      prompt: `This role is ${job.workMode}${job.location ? ` in ${job.location}` : ""}. Does that work for you?`,
    });
  }
  if (job.languages && job.languages.length) {
    steps.push({
      id: "ko_lang",
      type: "ko",
      prompt: `The role works in ${job.languages.join(" / ")}. Are you comfortable with that?`,
    });
  }
  return steps;
}

// Turn the captured answers into a CandidateProfileV2 intake draft (the same
// shape /api/profile takes), so a passing applicant becomes a real, matchable
// candidate rather than a label-only pipeline entry. Skills flow in as evidence
// (provenance-resolved by the Python normalizer).
export function buildApplyProfileDraft(
  job: JobRecord,
  answers: ApplyAnswers
): { profile: Record<string, unknown>; signals: Record<string, unknown> } {
  // The registry-free profile assembly (locale default + years parsing) lives in
  // apply-intake.ts and is pinned by apply-intake.test.ts.
  const profile = buildIntakeProfile(job, answers);

  // Trust a valid self-declaration (router treats it as primary at 0.9); fall
  // back to "auto" heuristic routing when the candidate skipped/garbled it.
  const selfDeclared =
    answers.archetype && ARCHETYPE_IDS.has(answers.archetype) ? answers.archetype : "auto";
  return { profile, signals: { selfDeclared } };
}
