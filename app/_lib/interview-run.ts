import { getDevCase, getJob, getPipelineEntry, type InterviewTurn } from "./db";
import { runAutomationTask } from "./automation-run";
import { defaultInterviewerInstructions } from "./voice";
import { getInterviewPrep } from "./interview-prep";
import { runInterviewPrep, type ChronologyBlock } from "./interview-prep-run";
import { buildScorecardNotes, transcriptToNotes } from "./interview-transcript";
import { GROUNDED_DEFAULT_MIN, QUICK_SCREEN_MIN } from "./interview-duration.mjs";
import { isEarlyCareer } from "./archetypes";
import {
  caseGroundedInterviewerInstructions,
  devCaseIdFromJobId,
  scenarioRunOfShow,
  STUDENT_SCRIPT_MIN,
  studentInterviewerInstructions,
  studentRunOfShow,
  type CaseInterviewScenario,
} from "./student-interview";

// Re-exported for back-compat: the transcript→notes flattener now lives with the
// rest of the documented truncation policy in ./interview-transcript.
export { transcriptToNotes };

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

function composeBrief(
  company: string,
  title: string,
  roleLine: string,
  prep: PrepPayload | undefined,
  durationMin: number
): string {
  const chron = prep?.chronology ?? [];
  if (chron.length === 0) return defaultInterviewerInstructions({ role: roleLine });
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
  durationMin: number;
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

  // Early-career entries get the student methodology instead of the prep
  // chronology — their CV can't carry the evaluation, so the agent LEADS. When
  // the role's dev case has a generated interview scenario, the brief is
  // case-grounded (every candidate hears the same material, so ratings stay
  // comparable); otherwise the generic six-phase script is the fallback.
  if (isEarlyCareer(entry.archetype)) {
    const base = {
      candidateLabel: entry.candidateLabel ?? null,
      jobId: entry.jobId ?? null,
      jobTitle: entry.jobTitle ?? null,
    };
    const caseId = devCaseIdFromJobId(entry.jobId);
    const scenario = caseId ? ((getDevCase(caseId)?.scenario as CaseInterviewScenario | null) ?? null) : null;
    if (scenario && Array.isArray(scenario.phases) && scenario.phases.length > 0) {
      return {
        instructions: caseGroundedInterviewerInstructions(scenario, {
          candidateLabel: entry.candidateLabel,
          roleLine,
          company,
        }),
        runOfShow: scenarioRunOfShow(scenario),
        durationMin: scenario.durationMin || STUDENT_SCRIPT_MIN,
        ...base,
      };
    }
    return {
      instructions: studentInterviewerInstructions({ candidateLabel: entry.candidateLabel, roleLine, company }),
      runOfShow: studentRunOfShow(),
      durationMin: STUDENT_SCRIPT_MIN,
      ...base,
    };
  }

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

  // The session's canonical length: a grounded plan carries its own run-of-show
  // duration (15–30 min, GROUNDED_DEFAULT_MIN if a plan omits it); with no
  // chronology we fall back to the ungrounded quick screen, so the candidate
  // portal shows the truthful ~5 min rather than a 20-minute promise it won't keep.
  const grounded = (prep?.chronology?.length ?? 0) > 0;
  const durationMin = grounded ? prep?.durationMin ?? GROUNDED_DEFAULT_MIN : QUICK_SCREEN_MIN;
  const runOfShow = (prep?.chronology ?? []).map((b) => b.topic).filter(Boolean);
  const instructions = composeBrief(company, title, roleLine, prep, durationMin);
  return {
    instructions,
    runOfShow,
    durationMin,
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
  const { notes, truncated, droppedTurns, droppedChars, keptTurns, totalTurns } =
    buildScorecardNotes(transcript);
  if (!notes) return null;
  // Make the silent-truncation cliff visible: only logs when sampling actually
  // discarded turns from the middle of the transcript (see ./interview-transcript).
  if (truncated) {
    console.warn(
      `[interview:scorecard] transcript head+tail sampled for entry ${entryId}: ` +
        `kept ${keptTurns}/${totalTurns} turns, dropped ${droppedTurns} middle turns (${droppedChars} chars). ` +
        `Scorecard scored a sampled transcript — opening and closing preserved, middle marked in-band.`
    );
  }
  const { result } = await runAutomationTask(entryId, "scorecard", notes);
  // Case-grounded interviews can mint observed evidence (step 4 of the case-first
  // design): when the conversation worked the role's shared case AND cleared the
  // honest gates, the candidate's profile gains observed-provenance skills — their
  // next match credits them at full trust and the early-career band narrows.
  // Best-effort enrichment, never a gate on the scorecard itself.
  try {
    const { mintObservedFromCaseInterview } = await import("./devcase-run");
    const { credited } = await mintObservedFromCaseInterview(entryId, result);
    if (credited.length > 0) {
      (result as Record<string, unknown>).observedSkills = credited;
    }
  } catch {
    /* minting is enrichment — a failure must not lose the scorecard */
  }
  return result;
}
