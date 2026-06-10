import { getPipelineEntry } from "./db";
import { runAutomationTask } from "./automation-run";
import { getInterviewPrep, saveInterviewPrep } from "./interview-prep";
import { isEarlyCareer } from "./archetypes";
import { studentPrepRunOfShow } from "./student-interview";
import { buildRunOfShow, type PrepQuestion } from "./run-of-show";

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

export async function runInterviewPrep(params: Record<string, unknown>, signal?: AbortSignal): Promise<Record<string, unknown>> {
  const entryId = String(params.entryId ?? "");
  const candidateLabel = (params.candidateLabel as string) ?? null;
  const jobTitle = (params.jobTitle as string) ?? null;
  // PREP2 — the recruiter's locale (passed in the task params; the detached task
  // can't read the cookie). Localizes the LLM questions (--lang) AND the
  // deterministic run-of-show/student-script scaffolding; persisted in the
  // payload so the modal knows which language the pack is in.
  const lang = params.lang === "cs" ? "cs" : "en";

  // The CV-derived recommended questions (LLM with deterministic fallback). The
  // `source` ("llm" | "deterministic") rides along in the payload so the modal can
  // disclose whether the plan was AI-tailored or a template fallback.
  // Forward the abort signal so a DELETE on a running interview_prep task actually stops the
  // (slow, LLM-bound) prep work + kills its Python child, instead of the cancel being a no-op
  // that leaves the work running and the slot held while the UI flips to "canceled".
  const prep = await runAutomationTask(entryId, "prep", "", signal, lang);
  const questions = (prep.result.questions as PrepQuestion[]) ?? [];
  const focusAreas = (prep.result.focusAreas as string[]) ?? [];

  const entry = getPipelineEntry(entryId);
  const plan = isEarlyCareer(entry?.archetype)
    ? studentPrepRunOfShow(questions, focusAreas, candidateLabel, jobTitle, lang)
    : buildRunOfShow(questions, focusAreas, candidateLabel, jobTitle, lang);

  const payload: Record<string, unknown> = { ...plan, source: prep.source, lang };
  // Carry forward human-authored keys across a regeneration. The generated plan is
  // rebuilt from scratch and saveInterviewPrep is a full-payload upsert, so without
  // this a Regenerate would silently destroy the recruiter's hand-entered scorecard,
  // checklist progress, and assigned interviewer (PREP1/PREP2/PREP5 payload seam) —
  // those live on the same row and survive only if re-merged here.
  const prev = getInterviewPrep(entryId);
  if (prev) {
    for (const key of ["humanScorecard", "userProgress", "interviewer"] as const) {
      if (prev.payload[key] !== undefined) payload[key] = prev.payload[key];
    }
  }
  saveInterviewPrep(entryId, candidateLabel, jobTitle, payload);
  return payload;
}
