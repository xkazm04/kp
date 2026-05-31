import { getPipelineEntry, type InterviewTurn } from "./db";
import { runAutomationTask } from "./automation-run";
import { defaultInterviewerInstructions } from "./voice";

// Bridges the voice interview to the existing automation tasks:
//  - grounded questions come from Task 4 (interview_prep)
//  - the transcript feeds Task 5 (interview_scorecard), which sets the
//    scorecard_review approval on the pipeline entry (Interview→Offer gate).
// Both reuse runAutomationTask, so they inherit its Claude-CLI+fallback path,
// caching, and entry→profile/job resolution.

export function transcriptToNotes(transcript: InterviewTurn[]): string {
  return transcript
    .map((t) => {
      const who = t.role === "candidate" ? "Candidate" : t.role === "interviewer" ? "Interviewer" : "System";
      return `${who}: ${t.text}`;
    })
    .join("\n");
}

function composeInstructions(questions: string[], focusAreas: string[], role: string): string {
  if (questions.length === 0) return defaultInterviewerInstructions({ role });
  const list = questions.map((q, i) => `(${i + 1}) ${q}`).join("  ");
  return [
    `You are a warm, professional first-round screening interviewer for ${role}.`,
    "Detect whether the candidate speaks Czech or English and respond in that language; follow them if they switch.",
    "Open with one sentence stating you are an AI assistant running a short first-round screen and that the call is transcribed.",
    `Work through these grounded questions one at a time, with a brief follow-up when useful: ${list}.`,
    focusAreas.length ? `Keep the focus on: ${focusAreas.join(", ")}.` : "",
    "Do not give feedback, scores, or any hiring decision. Keep the whole call under five minutes,",
    "then thank them and say a human recruiter will review the conversation.",
  ]
    .filter(Boolean)
    .join(" ");
}

/** Build the interviewer brief for a pipeline entry, grounded in Task 4 prep.
 *  Falls back to the generic brief if prep is unavailable. */
export async function buildGroundedInterview(entryId: string): Promise<{
  instructions: string;
  candidateLabel: string | null;
  jobId: string | null;
  jobTitle: string | null;
}> {
  const entry = getPipelineEntry(entryId);
  if (!entry) throw new Error("pipeline entry not found");
  const role = entry.jobTitle ?? "the role";
  let instructions = defaultInterviewerInstructions({ role });
  try {
    const { result } = await runAutomationTask(entryId, "prep");
    const rawQs = Array.isArray(result.questions) ? (result.questions as unknown[]) : [];
    const questions = rawQs
      .map((q) => (q && typeof q === "object" ? String((q as Record<string, unknown>).question ?? "") : ""))
      .filter(Boolean);
    const focus = Array.isArray(result.focusAreas) ? (result.focusAreas as unknown[]).map((f) => String(f)) : [];
    instructions = composeInstructions(questions, focus, role);
  } catch {
    /* prep unavailable (no profile / CLI absent) — keep the generic brief */
  }
  return {
    instructions,
    candidateLabel: entry.candidateLabel ?? null,
    jobId: entry.jobId ?? null,
    jobTitle: entry.jobTitle ?? null,
  };
}

/** Synthesize a scorecard from the call transcript (Task 5). Also sets the
 *  scorecard_review approval on the entry, so it lands in the Decisions queue. */
export async function runInterviewScorecard(
  entryId: string,
  transcript: InterviewTurn[]
): Promise<Record<string, unknown> | null> {
  const notes = transcriptToNotes(transcript).slice(0, 6000).trim();
  if (!notes) return null;
  const { result } = await runAutomationTask(entryId, "scorecard", notes);
  return result;
}
