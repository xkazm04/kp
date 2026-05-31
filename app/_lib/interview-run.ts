import { getJob, getPipelineEntry, type InterviewTurn } from "./db";
import { runAutomationTask } from "./automation-run";
import { defaultInterviewerInstructions } from "./voice";
import { getInterviewPrep } from "./interview-prep";
import { runInterviewPrep, type ChronologyBlock } from "./interview-prep-run";

// Bridges the voice interview to the existing pipeline:
//  - the agent's brief is built from the rich interview-prep artifact (the same
//    run-of-show the recruiter sees in the Schedule "Interview prep" modal) plus
//    a short company/position intro from the job record;
//  - the transcript feeds Task 5 (interview_scorecard), which sets the
//    scorecard_review approval on the entry (Interview→Offer gate).

type PrepPayload = {
  scenario?: string;
  durationMin?: number;
  focusAreas?: string[];
  chronology?: ChronologyBlock[];
};

export function transcriptToNotes(transcript: InterviewTurn[]): string {
  return transcript
    .map((t) => {
      const who = t.role === "candidate" ? "Candidate" : t.role === "interviewer" ? "Interviewer" : "System";
      return `${who}: ${t.text}`;
    })
    .join("\n");
}

function composeBrief(company: string, title: string, roleLine: string, prep: PrepPayload | undefined): string {
  const chron = prep?.chronology ?? [];
  if (chron.length === 0) return defaultInterviewerInstructions({ role: roleLine });
  const durationMin = prep?.durationMin ?? 20;
  const runOfShow = chron
    .map((b, i) => {
      const qs = (b.questions ?? []).filter(Boolean).map((q) => `“${q}”`).join(" ");
      const fu = b.followUp ? ` Optional follow-up: “${b.followUp}”.` : "";
      return `${i + 1}. ${b.topic} (${b.fromMin}–${b.toMin} min) — ${b.goal}${qs ? ` Ask: ${qs}.` : ""}${fu}`;
    })
    .join("  ");
  return [
    `You are a warm, professional first-round screening interviewer at ${company} for the ${roleLine} role.`,
    "You are male — when you speak Czech, use masculine grammatical forms for yourself (e.g. „rád bych“, „zeptal bych se“, „řekl jsem“).",
    "Detect whether the candidate speaks Czech or English and respond in that language; follow them if they switch.",
    `Begin by briefly introducing yourself as an AI assistant, ${company}, and the ${title} position in two or three sentences, and mention that the call is transcribed for a human recruiter.`,
    `Then lead the conversation through this run of show (about ${durationMin} minutes total), keeping each topic roughly time-boxed. Ask the listed questions naturally, one at a time, with short follow-ups, and adapt to the candidate's answers:`,
    runOfShow,
    "Do not give feedback, scores, or any hiring decision. When the agenda is covered, invite the candidate's questions, thank them, and say a human recruiter will review the conversation.",
  ].join(" ");
}

/** Build the interviewer brief + candidate-facing run-of-show titles for an
 *  entry, grounded in the rich interview-prep artifact (generated if missing). */
export async function buildGroundedInterview(entryId: string): Promise<{
  instructions: string;
  runOfShow: string[];
  candidateLabel: string | null;
  jobId: string | null;
  jobTitle: string | null;
}> {
  const entry = getPipelineEntry(entryId);
  if (!entry) throw new Error("pipeline entry not found");

  const job = entry.jobId ? getJob(entry.jobId) : null;
  const company = job?.company || "Česká spořitelna";
  const title = entry.jobTitle || job?.title || "the role";
  const ctx = [job?.seniority, job?.location, job?.workMode].filter(Boolean).join(" · ");
  const roleLine = ctx ? `${title} (${ctx})` : title;

  let prep = (getInterviewPrep(entryId)?.payload as PrepPayload | undefined) ?? undefined;
  if (!prep || !(prep.chronology && prep.chronology.length)) {
    try {
      prep = (await runInterviewPrep({
        entryId,
        candidateLabel: entry.candidateLabel,
        jobTitle: entry.jobTitle,
      })) as PrepPayload;
    } catch {
      /* prep unavailable (no profile / CLI absent) — fall back to a generic brief */
    }
  }

  const runOfShow = (prep?.chronology ?? []).map((b) => b.topic).filter(Boolean);
  const instructions = composeBrief(company, title, roleLine, prep);
  return {
    instructions,
    runOfShow,
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
