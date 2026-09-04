// Slices, not the `./db` barrel — see the note in app/_lib/llm-config.ts. This
// module is imported by /api/schedule for ONE duration helper, so the barrel made
// that route's first-hit compile the entire data layer on top of its own graph.
import { getDevCase, getSubmission } from "./db/devcase";
import { getJob, getJobWorkspace } from "./db/jobs";
import { promotedBriefForJob } from "./db/intakes";
import { briefIntentSummary } from "./intake-brief";
import { getEntryWorkspace, getPipelineEntry } from "./db/pipeline";
import type { PipelineEntry } from "./db/core";
import type { VoiceTurn } from "./voice/types";
import { runAutomationTask } from "./automation-run";
import { defaultInterviewerInstructions } from "./voice";
import { getInterviewPrep } from "./interview-prep";
import { interviewBriefStrings } from "./interview-prep-strings";
import { runInterviewPrep, type ChronologyBlock } from "./interview-prep-run";
import { buildScorecardNotes, coverageFromNotes, transcriptToNotes } from "./interview-transcript";
import { GROUNDED_DEFAULT_MIN, QUICK_SCREEN_MIN } from "./interview-duration.mjs";
import { isEarlyCareer } from "./archetypes";
import { isLocale, type Locale } from "@/i18n/locales";
import { devCaseIdForEntry } from "./devcase-identity";
import {
  caseGroundedInterviewerInstructions,
  PERSONA_CRAFT_RULES,
  PERSONA_GENDER_GRAMMAR,
  PERSONA_LANGUAGE_DETECT,
  PERSONA_ONE_QUESTION,
  scenarioRunOfShow,
  STUDENT_SCRIPT,
  STUDENT_SCRIPT_MIN,
  studentInterviewerInstructions,
  studentRunOfShow,
  type CaseInterviewScenario,
} from "./student-interview";
import { extractTelemetry } from "./interview-telemetry";
import { buildAsrKeywords } from "./voice/asr-keywords.mjs";
import {
  candidateSafeTopic,
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
// ONE table, every locale in i18n/locales.ts. The names are English on purpose:
// they are read by the agent inside an English instruction, not by the candidate.
// It used to be `preferred === "cs" ? "Czech" : "English"`, which told a German or
// French applicant's interviewer to open in English — the exact language the
// candidate had just declined at apply. `Record<Locale, …>` makes adding a locale
// a tsc error here rather than a silent fallback (locale-language-names parity
// test in interview-run.test.ts pins it too, for the .mjs/JSON readers).
export const OPENING_LANGUAGE_NAMES: Record<Locale, string> = {
  en: "English",
  cs: "Czech",
  de: "German",
  fr: "French",
};

function withOpeningLanguage(instructions: string, preferred: Locale | null): string {
  if (!preferred) return instructions;
  const name = OPENING_LANGUAGE_NAMES[preferred];
  return `${instructions} The candidate chose to apply in ${name}, so open the interview in ${name} (you may still follow them if they switch language later).`;
}

/** The no-feedback / no-praise closing rule every interviewer brief ends on. It
 *  was byte-duplicated across composeBrief and composeDebriefBrief, differing in
 *  exactly three words ("the agenda is" vs "the questions are"), so a wording fix
 *  landed in one brief and not the other. `covered` is that clause. */
function noJudgementClose(covered: "the agenda is" | "the questions are"): string {
  return (
    "Do not give feedback, scores, or any hiring decision, and never praise or judge the quality of an answer or tell the " +
    "candidate their thinking, instinct, or approach is right (avoid “great”, “impressive”, “exactly right”, “the right " +
    "instinct”, “on the right track”) — stay warm by showing interest and inviting them to continue (“thank you”, " +
    `“understood”, “tell me more”), not by approving. When ${covered} covered, invite the candidate's questions, thank ` +
    "them, and say a human recruiter will review the conversation."
  );
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
    noJudgementClose("the agenda is"),
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
// It used to be a module-level English array. The agenda is PERSISTED on the
// session (`run_of_show_json`) and rendered to the applicant on the candidate
// portal, so it belongs to the ENTRY's language, not to whoever pressed "Create
// link": a German applicant read four English bullets under an otherwise German
// page. It now comes from `interviewBriefStrings(entry.locale)` — the same
// locale-pinned catalog loader the prep pack uses (interview-prep-strings.ts).

/** The company / role / opening-language facts every brief in this module derives
 *  from the entry — byte-duplicated between buildGroundedInterview and
 *  buildCandidateSafeBrief until wave 37, which is how the two agendas were free
 *  to disagree about the role line they name. */
function entryBriefContext(entry: PipelineEntry) {
  const job = entry.jobId ? getJob(entry.jobId) : null;
  const company = job?.company || "Česká spořitelna";
  const title = entry.jobTitle || job?.title || "the role";
  const ctx = [job?.seniority, job?.location, job?.workMode].filter(Boolean).join(" · ");
  return {
    company,
    title,
    roleLine: ctx ? `${title} (${ctx})` : title,
    // Only an EXPLICIT candidate locale (not the workspace-default guess) is confident
    // enough to fix the opening language and the agenda language; anything unknown keeps
    // the bilingual greet-then-detect opener and the default catalog.
    preferredLang: (isLocale(entry.locale) ? entry.locale : null) as Locale | null,
  };
}

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
    noJudgementClose("the questions are"),
  ].join(" ");
}

/** The CANDIDATE-FACING agenda derived from a prep chronology — what gets stored
 *  as `interview_sessions.run_of_show_json` and rendered to the candidate.
 *
 *  Scrubbed at the SOURCE, not at each render site. A chronology `topic` is the
 *  LLM's free-text `competency` (run-of-show.ts: `topic = q.competency`) written
 *  under an interviewer prompt that asks it to cover the missing must-haves, so it
 *  comes back carrying the assessment annotation as a bracketed aside — "Test
 *  automation fundamentals (missing must-have)", "Motivation (aspiration
 *  mismatch)" — the shapes TP-L2-VOICE-01 found in the wild. The stored field is
 *  read by the candidate portal's agenda sidebar (app/interview/[token]/page.tsx),
 *  by /api/interview/simulate → InterviewSimTab, and by
 *  scripts/interview-brief-grounded.ts; /api/interview/complete's public
 *  projection strips it for exactly this reason, and /api/interview/connect's
 *  contract test forbids the annotations outright. Composing it clean here closes
 *  every one of those readers at once instead of one render site at a time.
 *
 *  The scrub is the SAME shape rule the client-sent EL brief uses
 *  (voice/candidate-brief.ts::candidateSafeTopic), so the next annotation phrasing
 *  is caught too, and the two candidate-facing agendas can't disagree. The
 *  INTERVIEWER brief (composeBrief's run-of-show) deliberately keeps the raw topic:
 *  it is server-side, interviewer-internal, and the annotation is the point there. */
export function candidateRunOfShow(chronology: ChronologyBlock[] | undefined | null): string[] {
  return (chronology ?? [])
    .map((b) => candidateSafeTopic(b?.topic))
    .filter((t): t is string => t !== null);
}

/** Build the interviewer brief + candidate-facing run-of-show titles for an
 *  entry, grounded in the rich interview-prep artifact (generated if missing).
 *
 *  Tenancy — a caller that HAS a session (POST /api/interview/create already
 *  resolves `currentWorkspace()` for its billing gate) should pass it: a foreign
 *  entry id then resolves to nothing, which is exactly the 404 a cross-team
 *  "Create link" deserves. A caller with no session (scripts, the eval harness)
 *  omits it and the ENTRY's own team is used — the by-id rule the sibling token
 *  flows follow (/api/interview/complete, /api/status/[token]). Either beats the
 *  bare read this replaces, which resolved against the DEFAULT team: on any other
 *  workspace "Create link" threw "pipeline entry not found", so the candidate
 *  drawer's voice-screen action and the Schedule tab's AI round were dead. */
export async function buildGroundedInterview(entryId: string, workspaceId?: string): Promise<{
  instructions: string;
  runOfShow: string[];
  durationMin: number;
  candidateLabel: string | null;
  jobId: string | null;
  jobTitle: string | null;
}> {
  const ws = workspaceId ?? getEntryWorkspace(entryId);
  const entry = getPipelineEntry(entryId, ws);
  if (!entry) throw new Error("pipeline entry not found");

  const { company, title, roleLine, preferredLang } = entryBriefContext(entry);

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
      runOfShow: (await interviewBriefStrings(entry.locale)).debriefRunOfShow,
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
    const caseId = devCaseIdForEntry(entry);
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

  // Same tenant as the entry read above — unscoped, this found no pack on any other
  // team and fell through to GENERATING one on every single call.
  let prep = (getInterviewPrep(entryId, ws)?.payload as PrepPayload | undefined) ?? undefined;
  if (!prep || !(prep.chronology && prep.chronology.length)) {
    try {
      // Same tenant as the entry above (3rd arg): the generated pack's task row and
      // its own entry re-read are workspace-filtered, so an unscoped generation on
      // any other team read back a null entry — the early-career plan silently came
      // out in the EXPERIENCED chronology shape and the pack lost its industry
      // rubric axes, for the one candidate the agent was about to interview.
      prep = (await runInterviewPrep(
        {
          entryId,
          candidateLabel: entry.candidateLabel,
          jobTitle: entry.jobTitle,
        },
        undefined,
        ws
      )) as PrepPayload;
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
  const runOfShow = candidateRunOfShow(prep?.chronology);
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
export async function buildCandidateSafeBrief(entryId: string): Promise<string | null> {
  // Tenant from the ENTRY, never a session: the only caller is the PUBLIC token
  // route /api/interview/connect, where the candidate has no workspace. Bare, this
  // read resolved against the DEFAULT team and returned null everywhere else, so
  // every other team's candidate heard the generic ungrounded prompt — no company,
  // no role, none of the run-of-show the recruiter had just built for them.
  const briefWs = getEntryWorkspace(entryId);
  const entry = getPipelineEntry(entryId, briefWs);
  if (!entry) return null;

  const { company, roleLine, preferredLang } = entryBriefContext(entry);
  const candidateLabel = entry.candidateLabel ?? null;
  // The candidate-facing topics in this brief are written FOR the applicant, so they
  // ride the entry's language like the stored agenda above.
  const strings = await interviewBriefStrings(entry.locale);

  // Same branch order as buildGroundedInterview: debrief > case-grounded student >
  // generic student > grounded prep > null (generic fallback).
  const followups = submissionFollowups(entry);
  if (followups.length > 0) {
    const questions = followups.map(sanitizeFollowupQuestion).filter((q): q is string => q !== null);
    if (questions.length === 0) return null;
    const blocks: CandidateSafeBlock[] = [
      { topic: strings.debriefRunOfShow[0], questions: [] },
      { topic: strings.debriefRunOfShow[1], questions },
      { topic: strings.debriefRunOfShow[3], questions: [] },
    ];
    return withOpeningLanguage(
      composeCandidateBrief({ company, roleLine, candidateLabel, durationMin: debriefDurationMin(followups.length), blocks }),
      preferredLang
    );
  }

  if (isEarlyCareer(entry.archetype)) {
    const caseId = devCaseIdForEntry(entry);
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

  // The entry's own tenant (resolved once at the top of this function): the
  // candidate-safe brief silently lost its grounded chronology off the default team.
  const prep = (getInterviewPrep(entryId, briefWs)?.payload as PrepPayload | undefined) ?? undefined;
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
    const extra = sanitizeChronologyBlock({ topic: strings.recruiterAddedQuestions, questions: imported });
    if (extra) blocks.push(extra);
  }
  return withOpeningLanguage(
    composeCandidateBrief({ company, roleLine, candidateLabel, durationMin: prep?.durationMin ?? GROUNDED_DEFAULT_MIN, blocks }),
    preferredLang
  );
}

/** The ASR keyword bias for ONE ElevenLabs conversation: the job's own stack in
 *  front of the account-wide floor, capped at the platform's per-conversation
 *  limit (app/_lib/voice/asr-keywords.mjs).
 *
 *  WHY IT IS SAFE ON THE WIRE: this rides back to the CANDIDATE'S BROWSER (the
 *  ElevenLabs override is client-sent, like the prompt), so it may carry only
 *  public job facts. It does — `requirements[].skill` and `detectedSkills` are
 *  the JD's own technology terms, the same ones the public job posting shows.
 *  Nothing candidate-specific and nothing recruiter-internal is read here: the
 *  entry is used ONLY to find the job. Keep it that way — the allow-list stance
 *  of voice/candidate-brief.ts applies to every field on this response.
 *
 *  Tenant from the ENTRY, never a session (the caller is a public token route —
 *  same rule as buildCandidateSafeBrief above). A null/unknown entry, a job we
 *  cannot read, or a job with no skills all fall back to the floor list rather
 *  than to nothing: an un-biased recognizer is the defect this exists to fix. */
export function interviewAsrKeywords(entryId: string | null | undefined): string[] {
  if (!entryId) return buildAsrKeywords();
  const entry = getPipelineEntry(entryId, getEntryWorkspace(entryId));
  const job = entry?.jobId ? getJob(entry.jobId) : null;
  if (!job) return buildAsrKeywords();
  // Requirements first: a must-have skill is likelier to be discussed (and so to
  // be misheard) than a term merely detected somewhere in the ad's prose.
  const jobTerms = [...(job.requirements ?? []).map((r) => r?.skill), ...(job.detectedSkills ?? [])];
  return buildAsrKeywords(jobTerms);
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
  // REQUIRED (wave 37). It used to default to DEFAULT_WORKSPACE_ID, so a caller that
  // forgot it scored, read the entry for telemetry, and minted observed skills against
  // the WRONG tenant — silently, on any team but the first. The one caller
  // (/api/interview/complete) already derives the entry’s team; making it required means
  // the next caller cannot forget.
  workspaceId: string
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
      const caseId = devCaseIdForEntry(entry);
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
  // honest gates, the candidate's profile gains observed-provenance skills and their
  // next match credits them at full trust. For ANY archetype: `observed` is a
  // provenance weight, not an early-career lever (ONE THREAD gap 3 — the
  // `isEarlyCareer` gate that used to sit inside the mint is gone; the one genuinely
  // early-career effect, the routing-confidence lift, self-gates in Python).
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
