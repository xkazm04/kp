import archetypeRegistry from "@/pipeline/jobfit/archetypes.json";
import type { JobRecord } from "./db";
import { buildIntakeProfile, type ApplyAnswers, type StepCondition } from "./apply-intake";

// Conversational, formless apply: a short chat that captures the candidate and
// runs job-derived knockout (KO) questions before they enter the pipeline.

// The locale default, the bilingual years parser, and the duplicate-application
// dedup-key helpers live in the registry-free `apply-intake` module so they can
// be unit-tested directly; re-exported here so the apply flow keeps a single
// public surface.
export {
  DEFAULT_APPLY_LANGUAGES,
  parseYearsExperience,
  normalizeApplicantName,
  applyDedupeKey,
} from "./apply-intake";

export type ApplyStep =
  | { id: string; type: "text"; prompt: string; placeholder?: string; when?: StepCondition }
  | { id: string; type: "ko"; prompt: string; when?: StepCondition }
  | { id: string; type: "choice"; prompt: string; options: { value: string; label: string }[]; when?: StepCondition };

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

/** Offer the archetype self-declaration step only when the registry exposes at
 *  least this many `applyLabel` options. Decision: a single option is NOT offered
 *  — a one-choice "question" is a non-question that adds intake friction and erodes
 *  trust without adding routing signal (with one archetype the heuristic
 *  auto-router already lands there). The fairness-critical question appears only
 *  when there is a genuine choice to declare. If the registry ever collapses to one
 *  applyLabel, every applicant intentionally falls to heuristic auto routing. */
const MIN_ARCHETYPE_OPTIONS_TO_OFFER = 2;

/** The pipeline-wide neutral baseline archetype ("business as usual" = an
 *  experienced professional on the standard, non-fairness-shielded path). It is the
 *  SAFE fallback when intake fails or yields no archetype: we must not GUESS a
 *  fairness-shielded archetype (student / career_switcher) from a broken intake —
 *  that could wrongly grant or deny shielding — so a degraded entry takes the
 *  neutral default and is flagged intake-degraded for manual capture, at which point
 *  the real archetype is recovered. Mirrors the Python `BAU` and the codebase-wide
 *  `?? "bau"` default. */
export const FALLBACK_ARCHETYPE = "bau";

// The archetype ids that get their own intake lane below. Any OTHER archetype —
// bau, a skipped question, or a future registry addition without a lane — falls
// through to the default "most relevant experience" question, so a new archetype
// can never silently get an empty intake.
const LANED_ARCHETYPES = ["student", "career_switcher"];

export function buildApplyScript(job: JobRecord): ApplyStep[] {
  const steps: ApplyStep[] = [
    {
      id: "name",
      type: "text",
      prompt: `Hi! Let's get you applied for ${job.title}${job.company ? ` at ${job.company}` : ""}. What's your name?`,
      placeholder: "Your name",
    },
    {
      // Captured up front so the candidate is reachable: without it every
      // follow-up (acknowledgement, interview invite, offer, rejection) has no
      // address and dead-letters. Stored on the pipeline entry as `contact`.
      id: "email",
      type: "text",
      prompt: "Thanks! What's the best email to reach you at? We'll use it to follow up about your application.",
      placeholder: "you@example.com",
    },
  ];

  // Asked EARLY (right after the name) because it now routes the rest of the
  // intake: a student's CV-equivalent information is their project/thesis,
  // studies and direction — not a "most relevant experience" question they can
  // only answer apologetically.
  if (APPLY_ARCHETYPE_OPTIONS.length >= MIN_ARCHETYPE_OPTIONS_TO_OFFER) {
    steps.push({
      id: "archetype",
      type: "choice",
      prompt: "Nice to meet you! Which best describes you right now? It helps us ask the right questions and assess you fairly.",
      options: APPLY_ARCHETYPE_OPTIONS,
    });
  }

  steps.push(
    // — student lane: evidence the early-career scoring model actually prices
    //   (project/thesis is the completeness checklist's highest-weight item;
    //   education detail + aspirations are its required fields).
    {
      id: "student_project",
      type: "text",
      when: { stepId: "archetype", oneOf: ["student"] },
      prompt:
        "Tell us about a school project, thesis, or anything you've built that you're proud of — and what exactly was yours in it?",
      placeholder: "e.g. My bachelor thesis: a small REST API for…",
    },
    {
      id: "student_education",
      type: "text",
      when: { stepId: "archetype", oneOf: ["student"] },
      prompt: "What are you studying — programme and specialisation — and when do you expect to graduate?",
      placeholder: "e.g. Computer Science at CTU, graduating June 2027",
    },
    {
      id: "student_aspirations",
      type: "text",
      when: { stepId: "archetype", oneOf: ["student"] },
      prompt: "What kind of role are you aiming for as you start out?",
      placeholder: "e.g. junior backend developer",
    },
    // — switcher lane: the prior field feeds transferable-meta-skill extraction;
    //   the direction answer becomes their aspirations.
    {
      id: "switch_prior",
      type: "text",
      when: { stepId: "archetype", oneOf: ["career_switcher"] },
      prompt: "Which field are you coming from, and what did you do there?",
      placeholder: "e.g. 6 years in finance as an analyst",
    },
    {
      id: "switch_aspirations",
      type: "text",
      when: { stepId: "archetype", oneOf: ["career_switcher"] },
      prompt: "What's drawing you to this field, and what kind of role are you aiming for?",
      placeholder: "e.g. moving into data engineering because…",
    },
    // — default lane (experienced, a skipped archetype question, or any archetype
    //   without its own lane).
    {
      id: "experience",
      type: "text",
      when: { stepId: "archetype", notOneOf: LANED_ARCHETYPES },
      prompt: "In a sentence or two, what's your most relevant recent experience for this role?",
      placeholder: "e.g. 3 years building Node.js APIs…",
    },
    {
      id: "skills",
      type: "text",
      prompt: "Which skills should we highlight for this role? (comma-separated)",
      placeholder: "e.g. React, Node.js, SQL",
    }
  );

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
