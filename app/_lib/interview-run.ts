// Slices, not the `./db` barrel — see the note in app/_lib/llm-config.ts. This
// module is imported by /api/schedule for ONE duration helper, so the barrel made
// that route's first-hit compile the entire data layer on top of its own graph.
import { getDevCase, getSubmission } from "./db/devcase";
import { getJob, getJobWorkspace } from "./db/jobs";
import { promotedBriefForJob } from "./db/intakes";
import { briefIntentSummary } from "./intake-brief";
import { getEntryWorkspace, getPipelineEntry } from "./db/pipeline";
import type { JobRecord, PipelineEntry } from "./db/core";
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
import { rubricCoverage } from "./interview-rubric";
import { buildAsrKeywords } from "./voice/asr-keywords.mjs";
import {
  candidateSafeTopic,
  composeCandidateBrief,
  sanitizeChronologyBlock,
  sanitizeFaqEntries,
  sanitizeFollowupQuestion,
  sanitizeScenarioPhase,
  type CandidateSafeBlock,
} from "./voice/candidate-brief";
import { isJobOpenForApplications } from "./job-ingest";
import {
  caseScenarioForEntry,
  importedQuestionsForBrief,
  MAX_BRIEF_IMPORTED_QUESTIONS,
  type InterviewKit,
  type PrepPayload,
} from "./interview-agenda";
import {
  capPostingText,
  privateDirectedBrief,
  resumeAddendum,
  type DirectedBrief,
  type RoleFacts,
} from "./voice/director-brief";
import type { InterviewAgenda, ResumeContext } from "./voice/director-types";
import { kitBookedMin, kitSpinesAnInterview } from "./interview-kit-booking";
import type { InterviewKit as JobKit } from "./interview-kit-types";

// Re-exported for back-compat: the transcript→notes flattener now lives with the
// rest of the documented truncation policy in ./interview-transcript.
export { transcriptToNotes };
// Re-exported for back-compat: the imported-question guard moved beside the agenda
// builder (interview-agenda.ts), which is the other reader of the prep payload.
export { importedQuestionsForBrief, MAX_BRIEF_IMPORTED_QUESTIONS };

// Bridges the voice interview to the existing pipeline:
//  - the agent's brief is built from the rich interview-prep artifact (the same
//    run-of-show the recruiter sees in the Schedule "Interview prep" modal) plus
//    a short company/position intro from the job record;
//  - the transcript feeds Task 5 (interview_scorecard), which sets the
//    scorecard_review approval on the entry (Interview→Offer gate).

/** What a DIRECTED build (spark ai-interview-parity) is given at connect: the kit
 *  built by interview-agenda.ts::buildInterviewKit — the ONE agenda both briefs list
 *  — and the director's resume state for a reconnect. */
export type DirectedBuildOptions = {
  /** The connect-time agenda + private notes. When present, the agenda REPLACES the
   *  legacy run-of-show in the brief and the director protocol rides with it. */
  kit?: InterviewKit | null;
  /** Non-null on a reconnect after a dropped call: appends the resumed-call addendum. */
  resume?: ResumeContext | null;
};

/** Append the resumed-call addendum when the director reports an earlier attempt. */
function withResume(text: string, resume: ResumeContext | null | undefined, agenda: InterviewAgenda | null): string {
  return resume ? `${text} ${resumeAddendum(resume, agenda)}` : text;
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
// bilingual greet-then-detect. Appending that line AFTER PERSONA_LANGUAGE_DETECT used to lose:
// the detect paragraph says it "outranks every other instruction", so a German applicant still
// heard a Czech+English greet. Preferred-locale briefs REPLACE that paragraph with an
// open-in-preferred + lock/follow rule. A null preferred language leaves the bilingual opener
// byte-identical (the Python eval port's default student brief stays in lockstep).
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

function preferredLanguageDetect(name: string): string {
  return (
    `The candidate chose to apply in ${name}, so open the interview in ${name}. ` +
    "Then LOCK onto the language the candidate replies in and use ONLY that language for every remaining turn — greetings, acknowledgements, and closing included. " +
    "Do not mix languages after your opening, and never switch unless the candidate does first (then follow them). " +
    "Before EVERY turn you produce, check which language the candidate's last message was in and answer in that language."
  );
}

function withOpeningLanguage(instructions: string, preferred: Locale | null): string {
  if (!preferred) return instructions;
  const replacement = preferredLanguageDetect(OPENING_LANGUAGE_NAMES[preferred]);
  if (instructions.includes(PERSONA_LANGUAGE_DETECT)) {
    return instructions.replace(PERSONA_LANGUAGE_DETECT, replacement);
  }
  return `${instructions} ${replacement}`;
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
  roleIntent?: string | null,
  // Spark ai-interview-parity: the director's agenda + protocol. When given, the
  // agenda listing REPLACES the run-of-show (imported questions are one of its
  // blocks, never a second list), the leadership frame follows the self-disclosure,
  // and the protocol sits after the role intent, before the no-judgement close.
  directed?: DirectedBrief | null
): string {
  const chron = prep?.chronology ?? [];
  // With no plan the quick-screen prompt states the booked length: the quick screen's
  // own 5 minutes, or a kit-pinned link's kit length (buildGroundedInterview), so the
  // saved fallback never promises a different call than the one booked.
  if (chron.length === 0 && !directed) return defaultInterviewerInstructions({ role: roleLine, durationMin });
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
    ...(directed
      ? [directed.frame, directed.header, directed.listing]
      : [
          `Then lead the conversation through this run of show (about ${durationMin} minutes total), keeping each topic roughly time-boxed. Ask the listed questions naturally, one at a time, with short follow-ups, and adapt to the candidate's answers:`,
          runOfShow + importedLine,
        ]),
    ...(roleIntent ? [roleIntent] : []),
    ...(directed ? [directed.protocol] : []),
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
  return jobBriefContext(job, entry.jobTitle || job?.title || "the role", entry.locale);
}

/** The JOB half of entryBriefContext — everything in it is a fact about the role, not
 *  about the person on the call, which is what lets a kit REHEARSAL (no entry) build
 *  the same role line, role facts and opening language a candidate's brief is built
 *  from. `locale` is the language whoever takes the call chose (an entry's, or the
 *  rehearsing recruiter's); only a real locale fixes the opening language. */
function jobBriefContext(job: JobRecord | null, title: string, locale: string | null | undefined) {
  const company = job?.company || "Česká spořitelna";
  const ctx = [job?.seniority, job?.location, job?.workMode].filter(Boolean).join(" · ");
  // The ROLE FACTS the director protocol lets the interviewer answer from (spark
  // ai-interview-parity). Public job facts only — they ride the CLIENT-SENT
  // ElevenLabs prompt too — and the posting text only while the job is publicly
  // live (isJobOpenForApplications: a seeded corpus row or `published`), so a
  // draft's or a closed role's text never reaches a candidate.
  const roleFacts: RoleFacts = {
    title,
    company,
    location: job?.location || null,
    workMode: job?.workMode || null,
    posting: job && isJobOpenForApplications(job.status ?? null) ? capPostingText(job.description) : null,
  };
  return {
    company,
    title,
    roleLine: ctx ? `${title} (${ctx})` : title,
    // Only an EXPLICIT candidate locale (not the workspace-default guess) is confident
    // enough to fix the opening language and the agenda language; anything unknown keeps
    // the bilingual greet-then-detect opener and the default catalog.
    preferredLang: (isLocale(locale) ? locale : null) as Locale | null,
    roleFacts,
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
  durationMin: number,
  // Directed (spark ai-interview-parity): the agenda gives each authorship question a
  // block of its own (the listen-for / red-flag notes ride the private listing), and
  // REPLACES the numbered question list.
  directed?: DirectedBrief | null
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
    ...(directed ? [directed.frame] : []),
    "Using AI tools to build the submission is expected and NEVER penalised — what matters is whether they own the decisions in it. Never imply suspicion or that authorship is being verified; every question is genuine curiosity about their reasoning.",
    ...(directed
      ? [
          directed.header,
          directed.listing,
          "In every decision block, push gently for the WHY, the alternative they rejected, and what would make them decide differently.",
        ]
      : [
          `Open by letting them walk you through their approach in their own words for a couple of minutes, then work through these questions (about ${durationMin} minutes total), one at a time, adapting natural follow-ups to their answers — push gently for the WHY, the alternative they rejected, and what would make them decide differently:`,
          questions,
        ]),
    "If an answer stays generic, ask for the specific moment in THEIR submission where they made that call. An honest “I don't know” or “the tool suggested it and I kept it” is useful signal — acknowledge it neutrally and move on.",
    ...(directed ? [directed.protocol] : []),
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
 *  drawer's voice-screen action and the Schedule tab's AI round were dead.
 *
 *  `opts` (spark ai-interview-parity) — the CONNECT-time variant:
 *    - `readOnly`: never generate a missing prep. /api/interview/connect is a PUBLIC
 *      door; a token holder must not be able to trigger a paid prep build. With no
 *      prep the result is the generic brief and `grounded` is false, so the caller
 *      keeps the session's stored snapshot instead.
 *    - `kit`: the connect-time agenda (interview-agenda.ts). The brief lists THAT
 *      agenda — the same blocks the candidate-safe brief and the director use — in
 *      place of the legacy run-of-show, with the director protocol.
 *    - `resume`: appends the resumed-call addendum.
 *  Without `opts` the result is exactly the pre-director brief (the create path). */
export async function buildGroundedInterview(
  entryId: string,
  workspaceId?: string,
  opts?: DirectedBuildOptions & {
    readOnly?: boolean;
    /** The job kit VERSION the link being minted will PIN (interview-invite.ts). A kit
     *  spines the interview of a candidate with no plan and of one with a CV plan, so
     *  it — not the plan, not the quick screen — sets `durationMin` there
     *  (interview-kit-booking.ts kitBookedMin), and the saved brief states that length.
     *  A work-sample debrief and a student script keep their own length. */
    pinnedKit?: JobKit | null;
  }
): Promise<{
  instructions: string;
  runOfShow: string[];
  durationMin: number;
  candidateLabel: string | null;
  jobId: string | null;
  jobTitle: string | null;
  /** False only when nothing grounded could be built (no prep, and `readOnly` forbade
   *  generating one): `instructions` is then the generic quick-screen brief. */
  grounded: boolean;
}> {
  const ws = workspaceId ?? getEntryWorkspace(entryId);
  const entry = getPipelineEntry(entryId, ws);
  if (!entry) throw new Error("pipeline entry not found");

  const { company, title, roleLine, preferredLang, roleFacts } = entryBriefContext(entry);
  const kit = opts?.kit ?? null;
  // The kit FAQ goes through the SAME allow-list sanitizer the candidate-safe brief uses
  // (buildCandidateSafeBrief below), so both providers answer from identical words.
  const directed = kit ? privateDirectedBrief(kit.agenda, kit.privateNotes, roleFacts, sanitizeFaqEntries(kit.faq)) : null;
  const finish = (text: string) => withResume(withOpeningLanguage(text, preferredLang), opts?.resume, kit?.agenda ?? null);

  // Entries promoted from an evaluated dev-case submission get the SUBMISSION
  // DEBRIEF: the take-home's evaluation minted authorship questions from their
  // observed decisions, and this conversation is where those hypotheses are
  // verified (the artifact alone can be wholly LLM-produced). Most specific
  // grounding available, so it wins over both the student script and prep.
  const followups = submissionFollowups(entry);
  if (followups.length > 0) {
    const durationMin = debriefDurationMin(followups.length);
    return {
      instructions: finish(composeDebriefBrief(company, roleLine, entry.candidateLabel ?? null, followups, durationMin, directed)),
      runOfShow: (await interviewBriefStrings(entry.locale)).debriefRunOfShow,
      durationMin,
      candidateLabel: entry.candidateLabel ?? null,
      jobId: entry.jobId ?? null,
      jobTitle: entry.jobTitle ?? null,
      grounded: true,
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
      grounded: true,
    };
    const caseId = devCaseIdForEntry(entry);
    const scenario = caseId ? ((getDevCase(caseId)?.scenario as CaseInterviewScenario | null) ?? null) : null;
    if (scenario && Array.isArray(scenario.phases) && scenario.phases.length > 0) {
      return {
        instructions: finish(
          caseGroundedInterviewerInstructions(scenario, {
            candidateLabel: entry.candidateLabel,
            roleLine,
            company,
            directed,
          })
        ),
        runOfShow: scenarioRunOfShow(scenario),
        durationMin: scenario.durationMin || STUDENT_SCRIPT_MIN,
        ...base,
      };
    }
    return {
      instructions: finish(studentInterviewerInstructions({ candidateLabel: entry.candidateLabel, roleLine, company, directed })),
      runOfShow: studentRunOfShow(),
      durationMin: STUDENT_SCRIPT_MIN,
      ...base,
    };
  }

  // Same tenant as the entry read above — unscoped, this found no pack on any other
  // team and fell through to GENERATING one on every single call.
  let prep = (getInterviewPrep(entryId, ws)?.payload as PrepPayload | undefined) ?? undefined;
  if (!opts?.readOnly && (!prep || !(prep.chronology && prep.chronology.length))) {
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
  // portal shows the truthful ~5 min rather than a 20-minute promise it won't keep…
  const grounded = (prep?.chronology?.length ?? 0) > 0;
  // …unless the link pins a job kit: then the kit decides, with or without a plan — ONE
  // rule the mint, the rehearsal, the scheduling estimate and connect all read.
  const pinnedKit = opts?.pinnedKit ?? null;
  const durationMin = kitSpinesAnInterview(pinnedKit)
    ? kitBookedMin(pinnedKit, prep)
    : grounded
      ? prep?.durationMin ?? GROUNDED_DEFAULT_MIN
      : QUICK_SCREEN_MIN;
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
  const instructions = finish(composeBrief(company, title, roleLine, prep, durationMin, roleIntent, directed));
  return {
    instructions,
    runOfShow,
    durationMin,
    candidateLabel: entry.candidateLabel ?? null,
    jobId: entry.jobId ?? null,
    jobTitle: entry.jobTitle ?? null,
    // A directed brief is grounded by its agenda even when the pack has since gone
    // (a resumed call keeps the stored agenda — interview-agenda.ts).
    grounded: grounded || directed !== null,
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
 *  to say, so the caller falls back to the generic candidate-safe prompt.
 *
 *  `opts.kit` (spark ai-interview-parity): the brief lists the connect-time AGENDA —
 *  the same blocks the private brief and the director use — through the allow-list
 *  listing in voice/candidate-brief.ts, with the director protocol and ROLE FACTS.
 *  `opts.resume` appends the resumed-call addendum. */
export async function buildCandidateSafeBrief(entryId: string, opts?: DirectedBuildOptions): Promise<string | null> {
  // Tenant from the ENTRY, never a session: the only caller is the PUBLIC token
  // route /api/interview/connect, where the candidate has no workspace. Bare, this
  // read resolved against the DEFAULT team and returned null everywhere else, so
  // every other team's candidate heard the generic ungrounded prompt — no company,
  // no role, none of the run-of-show the recruiter had just built for them.
  const briefWs = getEntryWorkspace(entryId);
  const entry = getPipelineEntry(entryId, briefWs);
  if (!entry) return null;

  const { company, roleLine, preferredLang, roleFacts } = entryBriefContext(entry);
  const candidateLabel = entry.candidateLabel ?? null;

  const kit = opts?.kit ?? null;
  if (kit) {
    // The agenda already carries every candidate-facing word (catalog titles, scrubbed
    // labels, allow-listed aloud questions); only the case narration — read ALOUD to
    // the candidate by design — comes from the scenario itself.
    const intro = kit.branch === "case" ? (caseScenarioForEntry(entry)?.caseIntro ?? null) : null;
    return withResume(
      withOpeningLanguage(
        composeCandidateBrief({
          company,
          roleLine,
          candidateLabel,
          durationMin: kit.agenda.durationMin,
          blocks: [],
          intro,
          agenda: kit.agenda,
          roleFacts,
          // Raw: composeCandidateBrief sanitizes it at the boundary.
          faq: kit.faq,
        }),
        preferredLang
      ),
      opts?.resume,
      kit.agenda
    );
  }
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
    return withResume(
      withOpeningLanguage(
        composeCandidateBrief({ company, roleLine, candidateLabel, durationMin: debriefDurationMin(followups.length), blocks }),
        preferredLang
      ),
      opts?.resume,
      null
    );
  }

  if (isEarlyCareer(entry.archetype)) {
    const caseId = devCaseIdForEntry(entry);
    const scenario = caseId ? ((getDevCase(caseId)?.scenario as CaseInterviewScenario | null) ?? null) : null;
    const phases = scenario && Array.isArray(scenario.phases) && scenario.phases.length > 0 ? scenario.phases : STUDENT_SCRIPT;
    const blocks = phases.map(sanitizeScenarioPhase).filter((b): b is CandidateSafeBlock => b !== null);
    if (blocks.length === 0) return null;
    return withResume(
      withOpeningLanguage(
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
      ),
      opts?.resume,
      null
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
  return withResume(
    withOpeningLanguage(
      composeCandidateBrief({ company, roleLine, candidateLabel, durationMin: prep?.durationMin ?? GROUNDED_DEFAULT_MIN, blocks }),
      preferredLang
    ),
    opts?.resume,
    null
  );
}

/** Both briefs for a recruiter's REHEARSAL of a job kit (spark interview-kit-template,
 *  WP-D) — the entry-less counterpart of buildGroundedInterview + buildCandidateSafeBrief
 *  on the kit branch, and deliberately composed through the SAME functions so that what
 *  the recruiter hears is what a candidate on a link pinned to this kit version would
 *  hear:
 *    - `instructions`: the private, server-minted brief — composeBrief with the directed
 *      agenda listing (private notes, must-asks, weights), the role's intake intent and
 *      the director protocol, exactly as the kit branch builds it;
 *    - `candidateBrief`: the client-sent (ElevenLabs) brief — composeCandidateBrief over
 *      the same agenda, through the same allow-list sanitizers.
 *  Minus what only a candidate carries: there is no name to greet ("You are speaking
 *  with …"), no CV, no prep and no overlay — the kit's agenda is the whole plan.
 *
 *  `kit` MUST be buildKitOnlyInterviewKit's (or a stored agenda reconciled against it):
 *  this function trusts it to carry nothing candidate-specific. `locale` is the
 *  rehearsing recruiter's language, standing in for the one a candidate chose at apply. */
export function buildRehearsalBriefs(
  jobId: string,
  kit: InterviewKit,
  opts?: { locale?: string | null; resume?: ResumeContext | null }
): { instructions: string; candidateBrief: string } {
  const job = getJob(jobId);
  const { company, title, roleLine, preferredLang, roleFacts } = jobBriefContext(job, job?.title || "the role", opts?.locale ?? null);
  // The role's intake intent is a JOB fact, so a rehearsal carries it exactly like the
  // candidate path does (same read, same best-effort fallback).
  let roleIntent: string | null = null;
  try {
    roleIntent = briefIntentSummary(promotedBriefForJob(jobId, getJobWorkspace(jobId)));
  } catch {
    /* grounding is enrichment — a missing/legacy intake rehearses without it, as a candidate would */
  }
  const directed = privateDirectedBrief(kit.agenda, kit.privateNotes, roleFacts, sanitizeFaqEntries(kit.faq));
  const instructions = withResume(
    withOpeningLanguage(composeBrief(company, title, roleLine, undefined, kit.agenda.durationMin, roleIntent, directed), preferredLang),
    opts?.resume,
    kit.agenda
  );
  const candidateBrief = withResume(
    withOpeningLanguage(
      composeCandidateBrief({
        company,
        roleLine,
        candidateLabel: null,
        durationMin: kit.agenda.durationMin,
        blocks: [],
        intro: null,
        agenda: kit.agenda,
        roleFacts,
        // Raw: composeCandidateBrief sanitizes it at the boundary.
        faq: kit.faq,
      }),
      preferredLang
    ),
    opts?.resume,
    kit.agenda
  );
  return { instructions, candidateBrief };
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
  return jobAsrKeywords(entry?.jobId ?? null);
}

/** The same keyword bias, keyed by the JOB — what a kit rehearsal (no entry) uses, and
 *  what interviewAsrKeywords resolves to once it has found the entry's job. The same
 *  public-job-facts-only rule applies: nothing here may be about a person. */
export function jobAsrKeywords(jobId: string | null | undefined): string[] {
  const job = jobId ? getJob(jobId) : null;
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
  if (!result) return null;
  // Deterministic call telemetry (hint-uptake, talk ratio, recovery-time proxies)
  // rides the scorecard, so validating potential_score's weights later has DATA
  // per interview instead of anecdotes. The hint to track is the scripted
  // coachability injection — the scenario's instantiated probe when the role has
  // a designed case, the generic script's otherwise. Proxies, not measurements
  // (extractTelemetry documents each one); best-effort, never a gate.
  try {
    const entry = getPipelineEntry(entryId, workspaceId);
    // Same coverage provenance the human POST stamps. Python already writes
    // rubricVersion/rubricKeys; this post-pass fills the gap without a Python bump
    // and will not overwrite if the scorer starts stamping it.
    stampAiScorecardRubricCoverage(result as Record<string, unknown>, entry?.roleFamily);
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

/** Stamp role-family industry-axis coverage on an AI scorecard after the spawn.
 *  Does not overwrite a value Python (or a later caller) already set. */
export function stampAiScorecardRubricCoverage(
  result: Record<string, unknown>,
  roleFamily: string | null | undefined,
): void {
  if (result.rubricCoverage != null) return;
  result.rubricCoverage = rubricCoverage(roleFamily);
}
