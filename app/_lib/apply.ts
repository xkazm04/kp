import type { useTranslations } from "next-intl";
import archetypeRegistry from "@/pipeline/jobfit/archetypes.json";
import type { JobRecord } from "./db/core";
import { buildIntakeProfile, type ApplyAnswers, type StepCondition } from "./apply-intake";

// The "apply"-namespace translator the caller threads in so the chat prompts are
// localized at build time (the candidate reads them verbatim — they cannot be
// English while the page chrome is Czech). Server-resolved per request via
// next-intl's getTranslations("apply"); this is its (structurally identical)
// type. Used only for the candidate-facing `prompt`/`placeholder`/option labels —
// step ids, conditions, and answer keys stay canonical.
export type ApplyTranslator = ReturnType<typeof useTranslations<"apply">>;

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
  // An `optional` text step renders a Skip control beside the input (the same
  // skip pattern as the file step below); skipping answers "" and moves on.
  | { id: string; type: "text"; prompt: string; placeholder?: string; optional?: boolean; when?: StepCondition }
  // An optional document upload (the CV step): the client extracts its text via
  // /api/extract-text and stores that as the step's answer, or the candidate skips.
  | { id: string; type: "file"; prompt: string; placeholder?: string; when?: StepCondition }
  | { id: string; type: "ko"; prompt: string; when?: StepCondition }
  | { id: string; type: "choice"; prompt: string; options: { value: string; label: string }[]; when?: StepCondition };

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

/** The UNCLASSIFIED sentinel persisted when intake fails or yields no archetype.
 *  We must not GUESS a fairness-shielded archetype (student / career_switcher)
 *  from a broken intake — but "bau" was never the neutral choice it looked like:
 *  it is a CONCRETE class ("business as usual" = an experienced professional), so
 *  persisting it on a record that asserts nothing was read strips the early-career
 *  fairness shield (`isFairnessProtected("bau")` is false) and applies the
 *  seniority KO floor. "unknown" is the fail-closed sentinel the rest of the
 *  codebase standardised on — `match-candidate.ts` and `candidate-pool.ts` pass it
 *  for exactly this reason, `archetypes.ts` shields anything it cannot classify,
 *  and the Python side agrees (`matching.py` shields `_EARLY_CAREER` and treats an
 *  archetype absent from `WEIGHTS` as unclassified; "bau" took neither branch).
 *  The entry is still flagged intake-degraded for manual capture, at which point
 *  the real archetype is recovered and replaces this sentinel. */
export const FALLBACK_ARCHETYPE = "unknown";

// The archetype ids that get their own intake lane below. Any OTHER archetype —
// bau, a skipped question, or a future registry addition without a lane — falls
// through to the default "most relevant experience" question, so a new archetype
// can never silently get an empty intake.
const LANED_ARCHETYPES = ["student", "career_switcher"];

// Candidate-facing label for a self-declared archetype, localized. Uses LITERAL
// catalog keys (typed) for the registry's known apply archetypes and falls back
// to the registry's own English `applyLabel` for any future archetype that
// hasn't been given a translation yet — so a new registry entry degrades to its
// English label rather than throwing on a missing key.
function archetypeApplyLabel(t: ApplyTranslator, id: string, fallback: string): string {
  switch (id) {
    case "bau":
      return t("archetypeBau");
    case "student":
      return t("archetypeStudent");
    case "career_switcher":
      return t("archetypeSwitcher");
    default:
      return fallback;
  }
}

// `t` is the per-request "apply" translator (server-resolved): the prompts the
// candidate reads must be in their language, so they're localized HERE at build
// time, not in the client (which receives them as plain display strings). Step
// ids, `when` conditions, and option `value`s stay canonical — only the visible
// `prompt`/`placeholder`/label text is localized.
export function buildApplyScript(job: JobRecord, t: ApplyTranslator): ApplyStep[] {
  const steps: ApplyStep[] = [
    // CV-first (idea-cddec0bf): offered up front, optional/skippable, so an
    // uploaded résumé can pre-fill the identity steps the candidate would
    // otherwise type. Folded in as high-weight evidence either way.
    {
      id: "cv",
      type: "file",
      prompt: t("script.cvPrompt"),
      placeholder: t("script.cvPlaceholder"),
    },
    {
      id: "name",
      type: "text",
      prompt: job.company
        ? t("script.greetingCompany", { jobTitle: job.title, company: job.company })
        : t("script.greeting", { jobTitle: job.title }),
      placeholder: t("script.namePlaceholder"),
    },
    {
      // Captured up front so the candidate is reachable: without it every
      // follow-up (acknowledgement, interview invite, offer, rejection) has no
      // address and dead-letters. Stored on the pipeline entry as `contact`.
      //
      // DECISION — the email contract, stated once, here (the step that owns it).
      // This step carries NO `optional: true`, so the conversational UI REQUIRES
      // an address: a human walking the chat must not be allowed to file an
      // application we can never answer. The server is deliberately more lenient
      // (POST /api/apply/[id] validates the SHAPE but files `contact: email ||
      // null`, and the dedupe has a contactless fallback) — that leniency exists
      // for SCRIPTED/webhook traffic and legacy contactless rows, NOT as a way
      // for the UI to skip the step. Do not "align" the two by relaxing this
      // step or by hard-rejecting a contactless POST: they are different trust
      // boundaries answering to different callers.
      id: "email",
      type: "text",
      prompt: t("script.emailPrompt"),
      placeholder: t("script.emailPlaceholder"),
    },
  ];

  // Localized option labels, keyed off the same registry ids (the `value` stays
  // canonical so routing/dedup are language-agnostic).
  const archetypeOptions = APPLY_ARCHETYPE_OPTIONS.map((o) => ({
    value: o.value,
    label: archetypeApplyLabel(t, o.value, o.label),
  }));

  // Asked EARLY (right after the name) because it now routes the rest of the
  // intake: a student's CV-equivalent information is their project/thesis,
  // studies and direction — not a "most relevant experience" question they can
  // only answer apologetically.
  if (archetypeOptions.length >= MIN_ARCHETYPE_OPTIONS_TO_OFFER) {
    steps.push({
      id: "archetype",
      type: "choice",
      prompt: t("script.archetypePrompt"),
      options: archetypeOptions,
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
      prompt: t("script.studentProjectPrompt"),
      placeholder: t("script.studentProjectPlaceholder"),
    },
    {
      id: "student_education",
      type: "text",
      when: { stepId: "archetype", oneOf: ["student"] },
      prompt: t("script.studentEducationPrompt"),
      placeholder: t("script.studentEducationPlaceholder"),
    },
    {
      id: "student_aspirations",
      type: "text",
      when: { stepId: "archetype", oneOf: ["student"] },
      prompt: t("script.studentAspirationsPrompt"),
      placeholder: t("script.studentAspirationsPlaceholder"),
    },
    // — switcher lane: the prior field feeds transferable-meta-skill extraction;
    //   the direction answer becomes their aspirations.
    {
      id: "switch_prior",
      type: "text",
      when: { stepId: "archetype", oneOf: ["career_switcher"] },
      prompt: t("script.switchPriorPrompt"),
      placeholder: t("script.switchPriorPlaceholder"),
    },
    {
      id: "switch_aspirations",
      type: "text",
      when: { stepId: "archetype", oneOf: ["career_switcher"] },
      prompt: t("script.switchAspirationsPrompt"),
      placeholder: t("script.switchAspirationsPlaceholder"),
    },
    // — default lane (experienced, a skipped archetype question, or any archetype
    //   without its own lane).
    {
      id: "experience",
      type: "text",
      when: { stepId: "archetype", notOneOf: LANED_ARCHETYPES },
      prompt: t("script.experiencePrompt"),
      placeholder: t("script.experiencePlaceholder"),
    },
    {
      id: "skills",
      type: "text",
      prompt: t("script.skillsPrompt"),
      placeholder: t("script.skillsPlaceholder"),
    }
  );

  // Optional GitHub profile — captured so an inbound applicant can carry the
  // same repo-signal evidence a recruiter-side add gets: the handle is shape-
  // gated to a bare username (coerceGithubHandle) and persisted on the entry
  // alongside `contact`, and the recruiter runs the deep-dive on demand from
  // the candidate drawer. Skippable, like the CV step — never a gate.
  steps.push({
    id: "github",
    type: "text",
    optional: true,
    prompt: t("script.githubPrompt"),
    placeholder: t("script.githubPlaceholder"),
  });

  // (The optional CV upload now leads the script — see the CV-first step above —
  // so an uploaded résumé can pre-fill the identity steps; it's still folded in as
  // high-weight evidence and remains fully skippable.)

  steps.push({
    id: "ko_auth",
    type: "ko",
    prompt: t("script.koAuth", { location: job.location || t("script.koAuthFallbackLocation") }),
  });

  if (job.workMode && job.workMode.toLowerCase() !== "remote") {
    steps.push({
      id: "ko_mode",
      type: "ko",
      prompt: job.location
        ? t("script.koModeLocation", { workMode: job.workMode, location: job.location })
        : t("script.koMode", { workMode: job.workMode }),
    });
  }
  if (job.languages && job.languages.length) {
    steps.push({
      id: "ko_lang",
      type: "ko",
      prompt: t("script.koLang", { languages: job.languages.join(" / ") }),
    });
  }
  return steps;
}

/** This job's knockout steps (id + localized prompt), derived from its own apply
 *  script so ko_mode/ko_lang stay conditional on workMode/languages. The single
 *  source both public intake surfaces gate on: the conversational POST checks the
 *  ids, the quick-apply lead form renders the prompts AND checks the ids — so the
 *  two channels can never drift to different eligibility rules for one job. */
export function applyKoSteps(job: JobRecord, t: ApplyTranslator): { id: string; prompt: string }[] {
  return buildApplyScript(job, t)
    .filter((s) => s.type === "ko")
    .map((s) => ({ id: s.id, prompt: s.prompt }));
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
