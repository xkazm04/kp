import { getDevCase, getJob, getPipelineEntry, getSubmission, type PipelineEntry, type VoiceTurn } from "./db";
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
  PERSONA_GENDER_GRAMMAR,
  PERSONA_LANGUAGE_DETECT,
  scenarioRunOfShow,
  STUDENT_SCRIPT,
  STUDENT_SCRIPT_MIN,
  studentInterviewerInstructions,
  studentRunOfShow,
  submissionIdFromCandidateId,
  type CaseInterviewScenario,
} from "./student-interview";
import { extractTelemetry } from "./interview-telemetry";

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
    PERSONA_GENDER_GRAMMAR,
    PERSONA_LANGUAGE_DETECT,
    `Begin by briefly introducing yourself as an AI assistant, ${company}, and the ${title} position in two or three sentences, and mention that the call is transcribed for a human recruiter.`,
    `Then lead the conversation through this run of show (about ${durationMin} minutes total), keeping each topic roughly time-boxed. Ask the listed questions naturally, one at a time, with short follow-ups, and adapt to the candidate's answers:`,
    runOfShow,
    "Do not give feedback, scores, or any hiring decision. When the agenda is covered, invite the candidate's questions, thank them, and say a human recruiter will review the conversation.",
  ].join(" ");
}

type SubmissionFollowup = { id?: string; decision?: string; question?: string; listenFor?: string; redFlag?: string };

/** Debrief length: ~3 min per minted question on top of the open walkthrough;
 *  capped to stay a screen. Single source for the brief AND the schedule estimate. */
function debriefDurationMin(followupCount: number): number {
  return Math.min(25, 8 + 3 * followupCount);
}

/** The minted authorship questions on an entry's evaluated submission (empty when
 *  the entry isn't a promoted dev-case submission or nothing was minted). */
function submissionFollowups(entry: PipelineEntry): SubmissionFollowup[] {
  const submissionId = submissionIdFromCandidateId(entry.candidateId);
  const submission = submissionId ? getSubmission(submissionId) : null;
  return ((submission?.evaluation as { followups?: { questions?: SubmissionFollowup[] } } | null)?.followups?.questions ?? []).filter(
    (f) => typeof f?.question === "string" && f.question.trim() !== ""
  );
}

// Candidate-facing agenda for the submission debrief — deliberately generic: the
// followups' decision/red-flag notes are interviewer-internal and must never leak
// into the run-of-show the candidate sees.
const DEBRIEF_RUN_OF_SHOW = ["Your take-home — how you approached it", "Decisions deep-dive", "Counterfactuals", "Your questions"];

/** The agent brief for a SUBMISSION DEBRIEF: the candidate completed the take-home
 *  and its evaluation minted authorship questions from THEIR observed decisions
 *  (evaluate.mint_followups). The artifact alone can be wholly LLM-produced, so this
 *  conversation — the why, the rejected alternative, the counterfactual — is where
 *  the evaluation actually happens. Tone is curiosity, never suspicion. */
function composeDebriefBrief(
  company: string,
  roleLine: string,
  candidateLabel: string | null,
  followups: SubmissionFollowup[],
  durationMin: number
): string {
  const name = candidateLabel ? ` You are speaking with ${candidateLabel}.` : "";
  const questions = followups
    .map((f, i) => {
      const listen = f.listenFor ? ` Listen for: ${f.listenFor}` : "";
      const flag = f.redFlag ? ` Internal red flag — never say this aloud: ${f.redFlag}` : "";
      return `${i + 1}. Ask: “${f.question}”${listen}${flag}`;
    })
    .join("  ");
  return [
    `You are a warm, professional interviewer at ${company} for the ${roleLine} role.${name}`,
    PERSONA_GENDER_GRAMMAR,
    PERSONA_LANGUAGE_DETECT,
    "Begin by briefly introducing yourself as an AI assistant in two sentences, mention the call is transcribed for a human recruiter, and say this conversation is about the take-home assignment they submitted — you'd like to understand how they approached it.",
    "Using AI tools to build the submission is expected and NEVER penalised — what matters is whether they own the decisions in it. Never imply suspicion or that authorship is being verified; every question is genuine curiosity about their reasoning.",
    `Open by letting them walk you through their approach in their own words for a couple of minutes, then work through these questions (about ${durationMin} minutes total), one at a time, adapting natural follow-ups to their answers — push gently for the WHY, the alternative they rejected, and what would make them decide differently:`,
    questions,
    "If an answer stays generic, ask for the specific moment in THEIR submission where they made that call. An honest “I don't know” or “the tool suggested it and I kept it” is useful signal — acknowledge it neutrally and move on.",
    "Do not give feedback, scores, or any hiring decision. When the questions are covered, invite the candidate's questions, thank them, and say a human recruiter will review the conversation.",
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

  // Entries promoted from an evaluated dev-case submission get the SUBMISSION
  // DEBRIEF: the take-home's evaluation minted authorship questions from their
  // observed decisions, and this conversation is where those hypotheses are
  // verified (the artifact alone can be wholly LLM-produced). Most specific
  // grounding available, so it wins over both the student script and prep.
  const followups = submissionFollowups(entry);
  if (followups.length > 0) {
    const durationMin = debriefDurationMin(followups.length);
    return {
      instructions: composeDebriefBrief(company, roleLine, entry.candidateLabel ?? null, followups, durationMin),
      runOfShow: DEBRIEF_RUN_OF_SHOW,
      durationMin,
      candidateLabel: entry.candidateLabel ?? null,
      jobId: entry.jobId ?? null,
      jobTitle: entry.jobTitle ?? null,
    };
  }

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

/** Read-only estimate of how long the entry's interview will run — the same
 *  branch order as buildGroundedInterview (debrief > case-grounded student >
 *  generic student > grounded prep > quick screen) WITHOUT its side effects: it
 *  never generates missing prep, so it is safe to call when minting a scheduling
 *  link. An entry whose prep doesn't exist yet reports the quick screen — the
 *  truthful floor — rather than a promise the brief may not keep. */
export function plannedInterviewMinutes(entry: PipelineEntry): number {
  const followups = submissionFollowups(entry);
  if (followups.length > 0) return debriefDurationMin(followups.length);
  if (isEarlyCareer(entry.archetype)) {
    const caseId = devCaseIdFromJobId(entry.jobId);
    const scenario = caseId ? ((getDevCase(caseId)?.scenario as CaseInterviewScenario | null) ?? null) : null;
    if (scenario && Array.isArray(scenario.phases) && scenario.phases.length > 0) {
      return scenario.durationMin || STUDENT_SCRIPT_MIN;
    }
    return STUDENT_SCRIPT_MIN;
  }
  const prep = (getInterviewPrep(entry.id)?.payload as PrepPayload | undefined) ?? undefined;
  const grounded = (prep?.chronology?.length ?? 0) > 0;
  return grounded ? prep?.durationMin ?? GROUNDED_DEFAULT_MIN : QUICK_SCREEN_MIN;
}

/** Synthesize a scorecard from the call transcript (Task 5). Also sets the
 *  scorecard_review approval on the entry, so it lands in the Decisions queue. */
export async function runInterviewScorecard(
  entryId: string,
  transcript: VoiceTurn[]
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
  // Deterministic call telemetry (hint-uptake, talk ratio, recovery-time proxies)
  // rides the scorecard, so validating potential_score's weights later has DATA
  // per interview instead of anecdotes. The hint to track is the scripted
  // coachability injection — the scenario's instantiated probe when the role has
  // a designed case, the generic script's otherwise. Proxies, not measurements
  // (extractTelemetry documents each one); best-effort, never a gate.
  try {
    const entry = getPipelineEntry(entryId);
    let hintText: string | null = null;
    if (entry && isEarlyCareer(entry.archetype)) {
      const caseId = devCaseIdFromJobId(entry.jobId);
      const scenario = caseId ? ((getDevCase(caseId)?.scenario as CaseInterviewScenario | null) ?? null) : null;
      const phases = scenario?.phases?.length ? scenario.phases : STUDENT_SCRIPT;
      hintText = phases.find((p) => p.caseGrounded && (p.feeds ?? []).includes("Coachability"))?.probe ?? null;
    }
    (result as Record<string, unknown>).telemetry = extractTelemetry(transcript, { hintText });
  } catch {
    /* telemetry is enrichment — a failure must not lose the scorecard */
  }
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
