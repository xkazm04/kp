// Slices, not the `./db` barrel — see the note in app/_lib/llm-config.ts. This
// module is imported by /api/schedule for ONE duration helper, so the barrel made
// that route's first-hit compile the entire data layer on top of its own graph.
import { getDevCase, getSubmission } from "./db/devcase";
import { getJob, getJobWorkspace } from "./db/jobs";
import { promotedBriefForJob } from "./db/intakes";
import { briefIntentSummary } from "./intake-brief";
import { getPipelineEntry } from "./db/pipeline";
import type { PipelineEntry } from "./db/core";
import type { VoiceTurn } from "./voice/types";
import { DEFAULT_WORKSPACE_ID } from "./db/workspaces";
import { runAutomationTask } from "./automation-run";
import { defaultInterviewerInstructions } from "./voice";
import { getInterviewPrep } from "./interview-prep";
import { runInterviewPrep, type ChronologyBlock } from "./interview-prep-run";
import { buildScorecardNotes, coverageFromNotes, transcriptToNotes } from "./interview-transcript";
import { GROUNDED_DEFAULT_MIN, QUICK_SCREEN_MIN } from "./interview-duration.mjs";
import { isEarlyCareer } from "./archetypes";
import { isLocale, type Locale } from "@/i18n/locales";
import {
  caseGroundedInterviewerInstructions,
  devCaseIdFromJobId,
  PERSONA_CRAFT_RULES,
  PERSONA_GENDER_GRAMMAR,
  PERSONA_LANGUAGE_DETECT,
  PERSONA_ONE_QUESTION,
  scenarioRunOfShow,
  STUDENT_SCRIPT,
  STUDENT_SCRIPT_MIN,
  studentInterviewerInstructions,
  studentRunOfShow,
  submissionIdFromCandidateId,
  type CaseInterviewScenario,
} from "./student-interview";
import { extractTelemetry } from "./interview-telemetry";
import {
  composeCandidateBrief,
  sanitizeChronologyBlock,
  sanitizeFollowupQuestion,
  sanitizeScenarioPhase,
  type CandidateSafeBlock,
} from "./voice/candidate-brief";

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
  // Interview-kit questions imported into the pack (written by /api/interview-prep
  // POST, rendered in the prep modal). Aloud-material the recruiter wants asked —
  // now carried into the voice brief alongside the generated chronology.
  importedQuestions?: string[];
};

/** Cap on imported interview-kit questions carried into a grounded brief, so a
 *  40-question import (the /api/interview-prep import cap) can't overwhelm the
 *  brief's length discipline. What is dropped is stated in the brief prose. */
export const MAX_BRIEF_IMPORTED_QUESTIONS = 8;

/** The imported interview-kit questions (prep payload `importedQuestions`) that
 *  should ride a grounded brief: trimmed, de-duplicated, and — the coordination
 *  guard with the sibling "weave into chronology" work — dropped when their exact
 *  text is already asked in a chronology block, so a woven question never
 *  double-renders. Pure/exported for the brief-construction unit tests. */
export function importedQuestionsForBrief(importedQuestions: unknown, alreadyAsked: Iterable<string>): string[] {
  const seen = new Set<string>();
  for (const q of alreadyAsked) if (typeof q === "string") seen.add(q.trim());
  const out: string[] = [];
  if (Array.isArray(importedQuestions)) {
    for (const raw of importedQuestions) {
      // Entries are legacy plain strings OR { question, blockRef? } objects (the
      // round-8 weave shape). Both must reach the brief — a woven question keeps
      // its single home in importedQuestions, so skipping objects would silently
      // drop exactly the questions the recruiter planned most deliberately.
      const text =
        typeof raw === "string"
          ? raw
          : raw && typeof raw === "object" && typeof (raw as { question?: unknown }).question === "string"
            ? (raw as { question: string }).question
            : null;
      if (text === null) continue;
      const q = text.trim();
      if (!q || seen.has(q)) continue;
      seen.add(q);
      out.push(q);
    }
  }
  return out;
}

/** The run-of-show tail for imported interview-kit questions: a single appended
 *  block, capped to MAX_BRIEF_IMPORTED_QUESTIONS with the cap stated in prose.
 *  Empty string when there is nothing to add, so an import-free brief is
 *  byte-identical to before this feature. */
function composeImportedRunOfShowLine(imported: string[]): string {
  if (imported.length === 0) return "";
  const shown = imported.slice(0, MAX_BRIEF_IMPORTED_QUESTIONS);
  const cap =
    imported.length > shown.length
      ? ` (the first ${shown.length} of ${imported.length} — ask the rest only if time allows)`
      : "";
  const qs = shown.map((q) => `“${q}”`).join(" ");
  return `  Also weave in these recruiter-added questions wherever they fit best${cap}: ${qs}.`;
}

// App §2 / P1 root cause: when the candidate EXPLICITLY chose a language at apply (entry.locale is
// a real locale, not the workspace-default guess), tell the agent to OPEN in it instead of the
// bilingual greet-then-detect. The follow/lock rules (PERSONA_LANGUAGE_DETECT) still apply, so a
// candidate who switches is still followed. A null preferred language leaves the bilingual opener.
function withOpeningLanguage(instructions: string, preferred: Locale | null): string {
  if (!preferred) return instructions;
  const name = preferred === "cs" ? "Czech" : "English";
  return `${instructions} The candidate chose to apply in ${name}, so open the interview in ${name} (you may still follow them if they switch language later).`;
}

export function composeBrief(
  company: string,
  title: string,
  roleLine: string,
  prep: PrepPayload | undefined,
  durationMin: number,
  // Phase 3 (role-intake): the interviewer-internal hiring-intent digest from
  // the promoted RoleBrief behind this job (intake-brief.ts::briefIntentSummary).
  // Rides AFTER the run-of-show so agenda order stays untouched; null on jobs
  // with no intake behind them.
  roleIntent?: string | null
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
  // Imported interview-kit questions ride the run-of-show as a capped appended
  // block, skipping any whose exact text a chronology block already asks (the
  // sibling weave-into-chronology guard, so nothing double-renders).
  const askedInChronology = chron.flatMap((b) => (b.questions ?? []).filter(Boolean));
  const imported = importedQuestionsForBrief(prep?.importedQuestions, askedInChronology);
  const importedLine = composeImportedRunOfShowLine(imported);
  return [
    `You are a warm, professional first-round screening interviewer at ${company} for the ${roleLine} role.`,
    PERSONA_ONE_QUESTION,
    ...PERSONA_CRAFT_RULES,
    // Gender-grammar + language lock stay ADJACENT and LAST (see student-interview.ts).
    PERSONA_GENDER_GRAMMAR,
    PERSONA_LANGUAGE_DETECT,
    `Begin by briefly introducing yourself as an AI assistant, ${company}, and the ${title} position in two or three sentences, and mention that the call is transcribed for a human recruiter.`,
    `Then lead the conversation through this run of show (about ${durationMin} minutes total), keeping each topic roughly time-boxed. Ask the listed questions naturally, one at a time, with short follow-ups, and adapt to the candidate's answers:`,
    runOfShow + importedLine,
    ...(roleIntent ? [roleIntent] : []),
    "Do not give feedback, scores, or any hiring decision, and never praise or judge the quality of an answer or tell the candidate their thinking, instinct, or approach is right (avoid “great”, “impressive”, “exactly right”, “the right instinct”, “on the right track”) — stay warm by showing interest and inviting them to continue (“thank you”, “understood”, “tell me more”), not by approving. When the agenda is covered, invite the candidate's questions, thank them, and say a human recruiter will review the conversation.",
  ].join(" ");
}

// The duration estimate and its two helpers live in the LEAF module
// ./interview-planned-minutes so the scheduling routes can import them without
// pulling this file's graph (voice, prep generation, transcripts, automation).
// Re-exported here so every existing `from "./interview-run"` import keeps working
// against a single definition.
import {
  debriefDurationMin,
  plannedInterviewMinutes,
  submissionFollowups,
  type SubmissionFollowup,
} from "./interview-planned-minutes";
export { debriefDurationMin, plannedInterviewMinutes, submissionFollowups, type SubmissionFollowup };

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
    PERSONA_ONE_QUESTION,
    ...PERSONA_CRAFT_RULES,
    // Gender-grammar + language lock stay ADJACENT and LAST (see student-interview.ts).
    PERSONA_GENDER_GRAMMAR,
    PERSONA_LANGUAGE_DETECT,
    "Begin by briefly introducing yourself as an AI assistant in two sentences, mention the call is transcribed for a human recruiter, and say this conversation is about the take-home assignment they submitted — you'd like to understand how they approached it.",
    "Using AI tools to build the submission is expected and NEVER penalised — what matters is whether they own the decisions in it. Never imply suspicion or that authorship is being verified; every question is genuine curiosity about their reasoning.",
    `Open by letting them walk you through their approach in their own words for a couple of minutes, then work through these questions (about ${durationMin} minutes total), one at a time, adapting natural follow-ups to their answers — push gently for the WHY, the alternative they rejected, and what would make them decide differently:`,
    questions,
    "If an answer stays generic, ask for the specific moment in THEIR submission where they made that call. An honest “I don't know” or “the tool suggested it and I kept it” is useful signal — acknowledge it neutrally and move on.",
    "Do not give feedback, scores, or any hiring decision, and never praise or judge the quality of an answer or tell the candidate their thinking, instinct, or approach is right (avoid “great”, “impressive”, “exactly right”, “the right instinct”, “on the right track”) — stay warm by showing interest and inviting them to continue (“thank you”, “understood”, “tell me more”), not by approving. When the questions are covered, invite the candidate's questions, thank them, and say a human recruiter will review the conversation.",
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
  // Only an EXPLICIT candidate locale (not the workspace-default guess) is confident enough to
  // fix the opening language; anything unknown keeps the bilingual greet-then-detect opener.
  const preferredLang: Locale | null = isLocale(entry.locale) ? entry.locale : null;

  // Entries promoted from an evaluated dev-case submission get the SUBMISSION
  // DEBRIEF: the take-home's evaluation minted authorship questions from their
  // observed decisions, and this conversation is where those hypotheses are
  // verified (the artifact alone can be wholly LLM-produced). Most specific
  // grounding available, so it wins over both the student script and prep.
  const followups = submissionFollowups(entry);
  if (followups.length > 0) {
    const durationMin = debriefDurationMin(followups.length);
    return {
      instructions: withOpeningLanguage(
        composeDebriefBrief(company, roleLine, entry.candidateLabel ?? null, followups, durationMin),
        preferredLang
      ),
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
        instructions: withOpeningLanguage(
          caseGroundedInterviewerInstructions(scenario, {
            candidateLabel: entry.candidateLabel,
            roleLine,
            company,
          }),
          preferredLang
        ),
        runOfShow: scenarioRunOfShow(scenario),
        durationMin: scenario.durationMin || STUDENT_SCRIPT_MIN,
        ...base,
      };
    }
    return {
      instructions: withOpeningLanguage(
        studentInterviewerInstructions({ candidateLabel: entry.candidateLabel, roleLine, company }),
        preferredLang
      ),
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
  // Phase 3 (role-intake): a job promoted from an intake carries the requestor's
  // stated intent (90-day outcomes, dealbreakers) — ground the interviewer on it.
  // Interviewer-internal only; the candidate-safe brief deliberately omits it.
  // Workspace derived from the job (the tenancy rule for out-of-session reads);
  // best-effort — a missing/legacy job grounds exactly as before.
  let roleIntent: string | null = null;
  if (entry.jobId) {
    try {
      roleIntent = briefIntentSummary(promotedBriefForJob(entry.jobId, getJobWorkspace(entry.jobId)));
    } catch {
      roleIntent = null;
    }
  }
  const instructions = withOpeningLanguage(composeBrief(company, title, roleLine, prep, durationMin, roleIntent), preferredLang);
  return {
    instructions,
    runOfShow,
    durationMin,
    candidateLabel: entry.candidateLabel ?? null,
    jobId: entry.jobId ?? null,
    jobTitle: entry.jobTitle ?? null,
  };
}

/** Candidate-safe GROUNDED brief for an entry — the ElevenLabs candidate-session
 *  counterpart of buildGroundedInterview. EL's signed-url flow has no server-side
 *  prompt config: the prompt override is client-sent (VoiceInterview.tsx), so it
 *  transits the candidate's BROWSER and must contain nothing the candidate may
 *  not read. Every block passes through the ALLOW-LIST sanitizers in
 *  voice/candidate-brief.ts (the unit-tested security boundary): topics,
 *  aloud-questions and time-boxes survive; goals, listenFor, redFlag and
 *  coachability stage directions do not. Read-only like plannedInterviewMinutes
 *  (never generates missing prep); returns null when there is nothing grounded
 *  to say, so the caller falls back to the generic candidate-safe prompt. */
export function buildCandidateSafeBrief(entryId: string): string | null {
  const entry = getPipelineEntry(entryId);
  if (!entry) return null;

  const job = entry.jobId ? getJob(entry.jobId) : null;
  const company = job?.company || "Česká spořitelna";
  const title = entry.jobTitle || job?.title || "the role";
  const ctx = [job?.seniority, job?.location, job?.workMode].filter(Boolean).join(" · ");
  const roleLine = ctx ? `${title} (${ctx})` : title;
  const preferredLang: Locale | null = isLocale(entry.locale) ? entry.locale : null;
  const candidateLabel = entry.candidateLabel ?? null;

  // Same branch order as buildGroundedInterview: debrief > case-grounded student >
  // generic student > grounded prep > null (generic fallback).
  const followups = submissionFollowups(entry);
  if (followups.length > 0) {
    const questions = followups.map(sanitizeFollowupQuestion).filter((q): q is string => q !== null);
    if (questions.length === 0) return null;
    const blocks: CandidateSafeBlock[] = [
      { topic: "Your take-home — how you approached it", questions: [] },
      { topic: "Decisions deep-dive", questions },
      { topic: "Your questions", questions: [] },
    ];
    return withOpeningLanguage(
      composeCandidateBrief({ company, roleLine, candidateLabel, durationMin: debriefDurationMin(followups.length), blocks }),
      preferredLang
    );
  }

  if (isEarlyCareer(entry.archetype)) {
    const caseId = devCaseIdFromJobId(entry.jobId);
    const scenario = caseId ? ((getDevCase(caseId)?.scenario as CaseInterviewScenario | null) ?? null) : null;
    const phases = scenario && Array.isArray(scenario.phases) && scenario.phases.length > 0 ? scenario.phases : STUDENT_SCRIPT;
    const blocks = phases.map(sanitizeScenarioPhase).filter((b): b is CandidateSafeBlock => b !== null);
    if (blocks.length === 0) return null;
    return withOpeningLanguage(
      composeCandidateBrief({
        company,
        roleLine,
        candidateLabel,
        durationMin: scenario?.durationMin || STUDENT_SCRIPT_MIN,
        blocks,
        // The case intro is narrated ALOUD to the candidate by design — safe to ground on.
        intro: scenario?.caseIntro ?? null,
      }),
      preferredLang
    );
  }

  const prep = (getInterviewPrep(entryId)?.payload as PrepPayload | undefined) ?? undefined;
  const chron = prep?.chronology ?? [];
  if (chron.length === 0) return null;
  const blocks = chron.map(sanitizeChronologyBlock).filter((b): b is CandidateSafeBlock => b !== null);
  if (blocks.length === 0) return null;
  // Imported interview-kit questions are aloud-material (the questions the recruiter
  // wants asked), so they reach the candidate-safe brief through the SAME allow-list
  // sanitizer as chronology questions — de-duped against questions already asked in
  // the plan (the sibling weave-into-chronology guard) and capped for length.
  const askedAloud = blocks.flatMap((b) => b.questions);
  const imported = importedQuestionsForBrief(prep?.importedQuestions, askedAloud).slice(0, MAX_BRIEF_IMPORTED_QUESTIONS);
  if (imported.length > 0) {
    const extra = sanitizeChronologyBlock({ topic: "Recruiter-added questions", questions: imported });
    if (extra) blocks.push(extra);
  }
  return withOpeningLanguage(
    composeCandidateBrief({ company, roleLine, candidateLabel, durationMin: prep?.durationMin ?? GROUNDED_DEFAULT_MIN, blocks }),
    preferredLang
  );
}

/* plannedInterviewMinutes moved to ./interview-planned-minutes (re-exported at the
   top of this file) — see the note there. It shares buildGroundedInterview's branch
   order (debrief > case-grounded student > generic student > grounded prep > quick
   screen); keep the two in step. */

/** Synthesize a scorecard from the call transcript (Task 5). Also sets the
 *  scorecard_review approval on the entry, so it lands in the Decisions queue. */
export async function runInterviewScorecard(
  entryId: string,
  transcript: VoiceTurn[],
  workspaceId: string = DEFAULT_WORKSPACE_ID
): Promise<Record<string, unknown> | null> {
  const scNotes = buildScorecardNotes(transcript);
  const { notes, truncated, droppedTurns, droppedChars, keptTurns, totalTurns } = scNotes;
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
  const { result } = await runAutomationTask(entryId, "scorecard", notes, undefined, undefined, workspaceId);
  // Deterministic call telemetry (hint-uptake, talk ratio, recovery-time proxies)
  // rides the scorecard, so validating potential_score's weights later has DATA
  // per interview instead of anecdotes. The hint to track is the scripted
  // coachability injection — the scenario's instantiated probe when the role has
  // a designed case, the generic script's otherwise. Proxies, not measurements
  // (extractTelemetry documents each one); best-effort, never a gate.
  try {
    const entry = getPipelineEntry(entryId, workspaceId);
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
  // Make the scoring-truncation cliff HONEST, not just logged: when head+tail
  // sampling meant the scorer read less than the full stored transcript, persist
  // structured coverage on the scorecard so the transcript modal can show a
  // truthful caveat. Attached only when truncated (coverageFromNotes returns
  // null otherwise), so a full-coverage score carries no coverage object and the
  // UI shows nothing — zero behavior change on the complete-transcript path.
  const coverage = coverageFromNotes(scNotes);
  if (coverage) (result as Record<string, unknown>).coverage = coverage;
  // Case-grounded interviews can mint observed evidence (step 4 of the case-first
  // design): when the conversation worked the role's shared case AND cleared the
  // honest gates, the candidate's profile gains observed-provenance skills — their
  // next match credits them at full trust and the early-career band narrows.
  // Best-effort enrichment, never a gate on the scorecard itself.
  try {
    const { mintObservedFromCaseInterview } = await import("./devcase-run");
    const { credited } = await mintObservedFromCaseInterview(entryId, result, workspaceId);
    if (credited.length > 0) {
      (result as Record<string, unknown>).observedSkills = credited;
    }
  } catch {
    /* minting is enrichment — a failure must not lose the scorecard */
  }
  return result;
}
