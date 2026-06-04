import { runAutomationTask } from "./automation-run";
import { saveInterviewPrep } from "./interview-prep";
import { buildRunOfShow, type PrepQuestion } from "./run-of-show";

// Build the interview-prep artifact: take the AI-generated, CV-derived interview
// questions (the existing "prep" automation) and design a timed run-of-show
// (15-30 min, see run-of-show.ts) + a topic-by-topic checklist the interviewer
// ticks off live. The timing contract + magic numbers now live in run-of-show.ts.

// Re-exported so existing importers (interview-run.ts) keep their import paths.
export type { ChronologyBlock, ChecklistGroup } from "./run-of-show";

export async function runInterviewPrep(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const entryId = String(params.entryId ?? "");
  const candidateLabel = (params.candidateLabel as string) ?? null;
  const jobTitle = (params.jobTitle as string) ?? null;

  // The CV-derived recommended questions (LLM with deterministic fallback). The
  // `source` ("llm" | "deterministic") rides along in the payload so the modal can
  // disclose whether the plan was AI-tailored or a template fallback.
  const prep = await runAutomationTask(entryId, "prep");
  const questions = (prep.result.questions as PrepQuestion[]) ?? [];
  const focusAreas = (prep.result.focusAreas as string[]) ?? [];

  const plan = buildRunOfShow(questions, focusAreas, candidateLabel, jobTitle);

  const payload: Record<string, unknown> = { ...plan, source: prep.source };
  saveInterviewPrep(entryId, candidateLabel, jobTitle, payload);
  return payload;
}
