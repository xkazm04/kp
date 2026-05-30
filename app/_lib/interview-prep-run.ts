import { runAutomationTask } from "./automation-run";
import { saveInterviewPrep } from "./interview-prep";

// Build the interview-prep artifact: take the AI-generated, CV-derived interview
// questions (the existing "prep" automation) and design a timed run-of-show
// (15-30 min) + a topic-by-topic checklist the interviewer ticks off live.

type PrepQuestion = { competency?: string; question?: string; whatsGoodLooksLike?: string; followUpIfAnswer?: string };

export type ChronologyBlock = { fromMin: number; toMin: number; topic: string; goal: string; questions: string[]; followUp?: string };
export type ChecklistGroup = { group: string; items: string[] };

export async function runInterviewPrep(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const entryId = String(params.entryId ?? "");
  const candidateLabel = (params.candidateLabel as string) ?? null;
  const jobTitle = (params.jobTitle as string) ?? null;

  // The CV-derived recommended questions (LLM with deterministic fallback).
  const prep = await runAutomationTask(entryId, "prep");
  const questions = ((prep.result.questions as PrepQuestion[]) ?? []).slice(0, 6);
  const focusAreas = ((prep.result.focusAreas as string[]) ?? []).slice(0, 5);

  const qMinutes = questions.length > 5 ? 3 : 4;
  const chronology: ChronologyBlock[] = [];
  let cursor = 0;
  const push = (mins: number, topic: string, goal: string, qs: string[], followUp?: string) => {
    chronology.push({ fromMin: cursor, toMin: cursor + mins, topic, goal, questions: qs, followUp });
    cursor += mins;
  };

  push(3, "Intro & rapport", "Set the candidate at ease, confirm the role context and the plan for the session.", []);
  questions.forEach((q, i) => {
    const topic = q.competency || `Topic ${i + 1}`;
    push(
      qMinutes,
      topic,
      q.whatsGoodLooksLike || "Probe depth and concrete examples; listen for ownership and trade-offs.",
      q.question ? [q.question] : [],
      q.followUpIfAnswer || undefined
    );
  });
  push(4, "Candidate questions & wrap-up", "Leave space for the candidate's questions; explain next steps and timeline.", []);
  const durationMin = cursor;

  // The chronology IS the run-of-show checklist (each block is checkable in the
  // modal), so the checklist here only carries the cross-cutting signals.
  const checklist: ChecklistGroup[] = [
    {
      group: "Signals to confirm",
      items: [
        ...focusAreas,
        "Probed the depth behind self-declared / project skills",
        "Covered the missing must-haves",
        "Gave the candidate space to ask questions",
      ],
    },
  ];

  const scenario =
    `A ${durationMin}-minute structured interview${candidateLabel ? ` for ${candidateLabel}` : ""}${jobTitle ? ` (${jobTitle})` : ""}. ` +
    `Validate strengths and probe ${focusAreas.slice(0, 3).join(", ") || "the key gaps"}. ` +
    "Keep each topic timeboxed and use the checklist to track coverage live.";

  const payload: Record<string, unknown> = { scenario, durationMin, focusAreas, chronology, checklist, source: prep.source };
  saveInterviewPrep(entryId, candidateLabel, jobTitle, payload);
  return payload;
}
