import { getPipelineEntry } from "./db/pipeline";
import { isLocale, DEFAULT_LOCALE } from "@/i18n/locales";
import { DEFAULT_WORKSPACE_ID } from "./db/workspaces";
import { runAutomationTask } from "./automation-run";
import { getInterviewPrep, saveInterviewPrep } from "./interview-prep";
import { isEarlyCareer } from "./archetypes";
import { studentPrepRunOfShow } from "./student-interview";
import { buildRunOfShow, type PrepQuestion, type RunOfShow } from "./run-of-show";
import { rosStrings, studentPrepStrings } from "./interview-prep-strings";
import { rubricCoverage, type RubricCoverage } from "./interview-rubric";

// Build the interview-prep artifact: take the AI-generated, CV-derived interview
// questions (the existing "prep" automation) and design a timed run-of-show
// (15-30 min, see run-of-show.ts) + a topic-by-topic checklist the interviewer
// ticks off live. The timing contract + magic numbers now live in run-of-show.ts.
//
// Early-career entries get the plan SHAPED AS THE SIX-PHASE STUDENT SCRIPT
// (studentPrepRunOfShow): their interview is agent-led per the script, so a
// chronology-shaped prep would describe a conversation that never happens. The
// CV-derived hypotheses still ride along — on the personal phases only.

// Re-exported so existing importers (interview-run.ts) keep their import paths.
export type { ChronologyBlock } from "./run-of-show";

export async function runInterviewPrep(params: Record<string, unknown>, signal?: AbortSignal, workspaceId: string = DEFAULT_WORKSPACE_ID): Promise<Record<string, unknown>> {
  const entryId = String(params.entryId ?? "");
  const candidateLabel = (params.candidateLabel as string) ?? null;
  const jobTitle = (params.jobTitle as string) ?? null;
  // PREP2 — the recruiter's locale (passed in the task params; the detached task
  // can't read the cookie). Localizes the LLM questions (--lang) AND the
  // deterministic run-of-show/student-script scaffolding; persisted in the
  // payload so the modal knows which language the pack is in.
  // F5 — was `params.lang === "cs" ? "cs" : "en"`, which silently rewrote a German
  // or French recruiter's locale to English before it reached either the prompt
  // directive or the scaffolding. All four locales now survive the narrowing
  // (runAutomationTask already re-validates with the same guard).
  const lang = isLocale(params.lang) ? params.lang : DEFAULT_LOCALE;

  // The CV-derived recommended questions (LLM with deterministic fallback). The
  // `source` ("llm" | "deterministic") rides along in the payload so the modal can
  // disclose whether the plan was AI-tailored or a template fallback.
  // Forward the abort signal so a DELETE on a running interview_prep task actually stops the
  // (slow, LLM-bound) prep work + kills its Python child, instead of the cancel being a no-op
  // that leaves the work running and the slot held while the UI flips to "canceled".
  const prep = await runAutomationTask(entryId, "prep", "", signal, lang, workspaceId);
  const questions = (prep.result.questions as PrepQuestion[]) ?? [];
  const focusAreas = (prep.result.focusAreas as string[]) ?? [];

  const entry = getPipelineEntry(entryId, workspaceId);
  const plan = isEarlyCareer(entry?.archetype)
    ? studentPrepRunOfShow(questions, focusAreas, candidateLabel, jobTitle, await studentPrepStrings(lang))
    : buildRunOfShow(questions, focusAreas, candidateLabel, jobTitle, await rosStrings(lang));

  // The keys the generator OWNS — enumerated EXPLICITLY (not spread) so the
  // regeneration invariant is structural, not a comment: the `RunOfShow &` type
  // means a new plan field can't ship without being listed here, and only these
  // keys are overwritten on Regenerate. saveInterviewPrep is a full-payload upsert
  // and the plan is rebuilt from scratch, so everything else on the row must be
  // carried forward — see mergeRegeneratedPrep.
  const generated: RunOfShow & { source: string; lang: string; rubricCoverage: RubricCoverage } = {
    scenario: plan.scenario,
    durationMin: plan.durationMin,
    focusAreas: plan.focusAreas,
    chronology: plan.chronology,
    signals: plan.signals,
    source: prep.source,
    lang,
    // What the pack's scorecard rubric covers at build time: whether the industry
    // axes were appended, and if not, WHY (no role family vs. a family with none
    // defined). Stamped alongside `source` because it is the same class of fact —
    // provenance of the artifact — and a pack read outside the modal (the copy-out,
    // the voice brief, an export) must carry it too, not just the rendered UI.
    // Never a guessed family; see rubricCoverage.
    rubricCoverage: rubricCoverage(entry?.roleFamily),
  };
  // The task's own tenant. Unscoped, a regeneration on any other team read no prior
  // pack, so mergeRegeneratedPrep had nothing to carry forward and the interviewer's
  // checklist, notes, imported questions and human scorecard were dropped.
  const prev = getInterviewPrep(entryId, workspaceId);
  const payload = mergeRegeneratedPrep(prev?.payload, generated);
  // `regenerated: true` — this is the ONE write that rebuilt the plan, so it is the
  // one allowed to move the artifact's created_at (the "generated NN ago" stamp and
  // the JD-staleness comparison). The import/weave read-merge-writes go through the
  // same upsert and must leave it alone; see saveInterviewPrep.
  saveInterviewPrep(entryId, candidateLabel, jobTitle, payload, { regenerated: true });
  return payload;
}

/** Merge a freshly generated prep plan onto the entry's PREVIOUS payload with an
 *  INVERTED merge: preserve EVERY previous key by default, overwrite ONLY the keys
 *  the generator produced (`generated`). This is the integrity fix for the old
 *  hardcoded 3-key allowlist ("humanScorecard", "userProgress", "interviewer"),
 *  which silently destroyed any human-authored payload key not on the list — a
 *  future recruiter-notes field, a re-scoring annotation, anything new. Now the
 *  default is preservation and the generator's ownership is the explicit exception,
 *  so an unknown human key survives a Regenerate structurally. Pure + dependency-free
 *  so the invariant is unit-testable (interview-prep-run.test.ts). */
export function mergeRegeneratedPrep(
  prevPayload: Record<string, unknown> | null | undefined,
  generated: Record<string, unknown>
): Record<string, unknown> {
  return { ...(prevPayload ?? {}), ...generated };
}
