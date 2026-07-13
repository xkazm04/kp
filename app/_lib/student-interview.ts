// The canonical early-career interview thought-script. The PHASES live in
// pipeline/jobfit/interview-script.json — the SAME file the Python scenario
// generator (devcase/interview_scenario.py) instantiates case-grounded probes
// from, the single-source pattern of interview-rubrics.json — and this module is
// the TS view of it: the About visualization, the simulator's run-of-show, and
// the agent briefs that actually LEAD the conversation.
//
// Two briefs share one persona contract (AI disclosure + transcription note,
// Czech/English detection, no feedback or decisions, deliberate coachability
// hint, quotable specifics, "I don't know" is a good answer):
//   * studentInterviewerInstructions() — the GENERIC script (fallback for roles
//     without a designed case);
//   * caseGroundedInterviewerInstructions() — the CASE-DESIGNED interview: the
//     mechanism/counterfactual/coachability phases are instantiated from a
//     designed work-sample case, so every candidate on the role faces the same
//     material and ratings stay comparable.

import script from "@/pipeline/jobfit/interview-script.json";
import type { PrepQuestion, RunOfShow, ChronologyBlock } from "./run-of-show";

export type StudentScriptPhase = {
  phase: string;
  minutes: string;
  goal: string;
  probe: string;
  listenFor: string;
  /** Early-career rubric competencies this phase feeds (interview-rubrics.json names). */
  feeds: string[];
  /** True for the phases a designed case instantiates (mechanism / counterfactual / coachability). */
  caseGrounded?: boolean;
};

export const STUDENT_SCRIPT: StudentScriptPhase[] = script.phases as StudentScriptPhase[];

/** Honest total for the scripted screen — the phases sum to ~20–25 minutes. */
export const STUDENT_SCRIPT_MIN: number = script.durationMin;

/** Candidate-facing agenda titles (the sidebar run-of-show). */
export function studentRunOfShow(): string[] {
  return STUDENT_SCRIPT.map((p) => p.phase);
}

/** The simulator's "regular candidate" lane: the standard ungrounded quick screen
 *  (defaultInterviewerInstructions) with a matching candidate-facing agenda. */
export const REGULAR_DEMO_RUN_OF_SHOW = ["Recent experience", "Depth follow-ups", "Your questions"];

// ---- CV-grounded prep on the student script ------------------------------------

/** How many CV-derived questions a personal phase can absorb before the plan
 *  stops being the script and starts being a quiz. 3 personal phases × 2 = the
 *  same six-question budget the BAU run-of-show plans for. */
const PREP_QUESTIONS_PER_PERSONAL_PHASE = 2;

/** Lower bound of a phase's "3–4 min" style budget; the script's own total
 *  (STUDENT_SCRIPT_MIN) absorbs the slack via the last block. */
function phaseMinutes(p: StudentScriptPhase): number {
  const n = parseInt(p.minutes, 10);
  return Number.isFinite(n) && n > 0 ? n : 3;
}

/** The early-career twin of buildRunOfShow: the recruiter's interview-prep plan
 *  SHAPED AS THE SIX-PHASE SCRIPT rather than a CV chronology. The CV-derived
 *  question hypotheses (the "prep" automation's output) are mapped round-robin
 *  onto the PERSONAL phases only — anchor / stuck-and-recovered / calibration —
 *  where the candidate's own story is the material; the case-grounded phases
 *  keep exactly the script probe, because their material is SHARED across every
 *  candidate on the role and a per-candidate question there would break rating
 *  comparability. Pure and deterministic, mirroring run-of-show.ts's contract
 *  that the header duration equals the last block's end. */
export function studentPrepRunOfShow(
  rawQuestions: PrepQuestion[],
  rawFocusAreas: string[],
  candidateLabel: string | null,
  jobTitle: string | null,
  lang: string = "en"
): RunOfShow {
  // PREP2 — the cross-cutting signals + scenario wrapper localize; the six-phase
  // STUDENT_SCRIPT prose stays English (it is the fixed pedagogical script the
  // voice agent — which already detects cs/en — delivers, not free prose).
  const cs = lang === "cs";
  const focusAreas = (rawFocusAreas ?? []).slice(0, 5);
  const personalPhases = STUDENT_SCRIPT.filter((p) => !p.caseGrounded);
  const capacity = personalPhases.length * PREP_QUESTIONS_PER_PERSONAL_PHASE;
  const questions = (rawQuestions ?? []).filter((q) => q.question).slice(0, capacity);

  const byPhase = new Map<string, string[]>();
  questions.forEach((q, i) => {
    const phase = personalPhases[i % personalPhases.length].phase;
    byPhase.set(phase, [...(byPhase.get(phase) ?? []), q.question as string]);
  });

  const chronology: ChronologyBlock[] = [];
  let cursor = 0;
  for (const p of STUDENT_SCRIPT) {
    const mins = phaseMinutes(p);
    chronology.push({
      fromMin: cursor,
      toMin: cursor + mins,
      topic: p.phase,
      goal: `${p.goal} ${cs ? "Sledujte:" : "Listen for:"} ${p.listenFor}`,
      questions: [p.probe, ...(byPhase.get(p.phase) ?? [])],
    });
    cursor += mins;
  }
  // Phase lower bounds usually undershoot the script's honest total — extend the
  // final block so the header duration and the last end time never disagree.
  if (cursor < STUDENT_SCRIPT_MIN) {
    chronology[chronology.length - 1].toMin += STUDENT_SCRIPT_MIN - cursor;
    cursor = STUDENT_SCRIPT_MIN;
  }

  const signals: string[] = cs
    ? [
        ...focusAreas,
        "Nápověda nabídnuta ve fázi koučovatelnosti — sledováno přijetí",
        "Doslovné citace zachyceny pro každý prvek rubriky",
        "Hypotézy z CV prozkoumány v osobních fázích (kotva / zaseknutí / kalibrace)",
      ]
    : [
        ...focusAreas,
        "Hint offered in the coachability phase — uptake observed",
        "Verbatim quotes captured for every rubric construct",
        "CV hypotheses probed on the personal phases (anchor / stuck / calibration)",
      ];

  const who = candidateLabel ? ` ${cs ? "pro" : "for"} ${candidateLabel}${jobTitle ? ` (${jobTitle})` : ""}` : jobTitle ? ` (${jobTitle})` : "";
  const focus = focusAreas.slice(0, 3).join(", ") || (cs ? "nejsilnější projekt kandidáta" : "the candidate's strongest project");
  const scenario = cs
    ? `Šestifázový screening pro začínající talenty na ${cursor} minut${who}. Vede agent; fáze založené na případové studii zůstávají u sdíleného materiálu role kvůli porovnatelnosti a probe z CV jedou v osobních fázích. Ověřte ${focus} podle rubriky živě.`
    : `A ${cursor}-minute six-phase early-career screen${who}. The agent leads; case-grounded phases stay on the role's shared material for comparability, and the CV-derived probes ride the personal phases. Validate ${focus} against the rubric live.`;

  return { scenario, durationMin: cursor, focusAreas, chronology, signals };
}

// ---- Shared persona contract -------------------------------------------------

// The two compliance-relevant persona lines that are byte-identical across EVERY
// runtime brief builder (this module's two briefs + interview-run's composeBrief/
// composeDebriefBrief + voice/index's defaultInterviewerInstructions): the agent's
// gender→Czech-grammar instruction and the Czech/English language-detection rule.
// Exported as the single source so a wording change (or a future neutral/female
// variant) lands once instead of being hand-applied in five places. The other
// persona lines (AI disclosure phrasing, role intro, closing verb) legitimately
// differ per builder and are intentionally NOT shared here.
export const PERSONA_GENDER_GRAMMAR =
  "You are male — when you speak Czech, use masculine grammatical forms for yourself (e.g. „rád bych“, „zeptal bych se“, „řekl jsem“).";
export const PERSONA_LANGUAGE_DETECT =
  "Do not assume the candidate's language: open by greeting briefly in both Czech and English, then LOCK onto the one language the candidate replies in and use ONLY that language for every remaining turn — greetings, acknowledgements, and closing included. Do not mix the two languages after your opening, and never switch to the other language unless the candidate does first (then follow them).";
// One-question-at-a-time (P3): the model tends to bundle two asks per turn, worst for nervous/
// terse candidates. Shared across every builder like the two lines above.
export const PERSONA_ONE_QUESTION =
  "Ask exactly ONE question per turn and wait for the answer before asking the next — never bundle a second question or a follow-up into the same turn. This matters most with nervous, terse, or quiet candidates: keep each prompt short and single, and give them room to answer.";

// The interviewer-craft rules (P4–P7 from docs/INTERVIEW_IMPROVEMENT_INPUTS.md §1, ranked from a
// judged eval sweep). Like the persona lines above they are byte-identical across EVERY brief
// builder — they change HOW the agent conducts any interview (drawing-out, depth-probing, floor
// control, composure), so they belong in the shared contract, not per-script prose.

// P4 — draw out terse/quiet candidates; re-asks NARROW rather than repeat verbatim.
export const PERSONA_DRAW_OUT =
  "When an answer is one line or dismissive, do not move on — ask a single concrete follow-up (a specific detail, a concrete example, or “what would you have done if…”). When re-asking, NARROW to one smaller, more concrete sub-question — never repeat the same question verbatim.";
// P5 — probe strong/quantitative claims; let coverage (not a fixed count) decide length; never telegraph.
export const PERSONA_VERIFY_CLAIMS =
  "When a candidate makes a strong or quantitative claim, ask how they achieved or verified it before you move on. Let coverage — not a fixed number of questions — decide the length: go deeper where depth is evident, and never announce how many questions remain (no “one last question”).";
// P6 — assert AND MAINTAIN control of a monologuing/off-topic candidate every time, not once.
export const PERSONA_HOLD_FLOOR =
  "With a rambling or monologuing candidate, set a concrete expectation up front and cut in politely at the first natural pause EVERY time it recurs — not just the first time. If the candidate asks an off-topic question, close it off briefly in one line, then return to your question.";
// P7 — acknowledge hostility briefly and neutrally, then redirect; never over-apologise or negotiate.
export const PERSONA_HOSTILITY =
  "If a candidate is hostile or challenges the premise of the interview, acknowledge it briefly and neutrally, then redirect to your question — do not over-apologise, and do not negotiate the premise of the interview.";

/** The P4–P7 interviewer-craft rules in canonical order — appended to every brief builder so a
 *  wording change lands once. Kept as an array (not a pre-joined string) so each builder joins it
 *  into its own surrounding prose with the same single-space separator. */
export const PERSONA_CRAFT_RULES: string[] = [
  PERSONA_DRAW_OUT,
  PERSONA_VERIFY_CLAIMS,
  PERSONA_HOLD_FLOOR,
  PERSONA_HOSTILITY,
];

function personaLines(company: string, role: string, name: string): string[] {
  return [
    `You are a warm, professional first-round interviewer at ${company} for ${role}, speaking with an EARLY-CAREER candidate — a student with little or no formal work history.${name}`,
    PERSONA_GENDER_GRAMMAR,
    PERSONA_LANGUAGE_DETECT,
    PERSONA_ONE_QUESTION,
    ...PERSONA_CRAFT_RULES,
    "Begin by briefly introducing yourself as an AI assistant and the purpose of the conversation in two sentences, and mention that the call is transcribed for a human recruiter.",
  ];
}

const NON_NEGOTIABLES =
  "Non-negotiables: in the coachability phase, deliberately offer ONE concrete hint or gentle pushback mid-problem and observe whether they integrate it — never skip this. Push for specifics a reviewer could quote verbatim. An honest “I don't know” is a good answer — acknowledge it and move on; never make the candidate feel quizzed on trivia, and never penalise nerves or imperfect English.";

const CLOSING =
  "Do not give feedback, scores, or any hiring decision, and never praise or judge the quality of an answer or tell the candidate their thinking, instinct, or approach is right (avoid “great”, “impressive”, “exactly right”, “the right instinct”, “on the right track”) — stay warm by showing interest and inviting them to continue (“thank you”, “understood”, “tell me more”), not by approving. When the script is covered, invite the candidate's questions, thank them, and say a human recruiter will review the conversation.";

function phaseLines(phases: StudentScriptPhase[]): string {
  return phases
    .map((p, i) => `${i + 1}. ${p.phase} (${p.minutes}) — ${p.goal} Ask: ${p.probe} Listen for: ${p.listenFor}`)
    .join("  ");
}

/** The agent brief that LEADS a student first-round per the GENERIC script —
 *  the fallback for roles without a designed case. */
export function studentInterviewerInstructions(opts?: {
  candidateLabel?: string | null;
  roleLine?: string | null;
  company?: string | null;
}): string {
  const company = opts?.company || "Česká spořitelna";
  const role = opts?.roleLine || "a junior engineering role (entry-eligible)";
  const name = opts?.candidateLabel ? ` You are speaking with ${opts.candidateLabel}.` : "";
  return [
    ...personaLines(company, role, name),
    `Their CV cannot carry the evaluation, so YOU lead the conversation to generate the signal. Follow this run of show (about ${STUDENT_SCRIPT_MIN} minutes total), one question at a time, keeping each phase roughly time-boxed and adapting follow-ups to their answers — but cover every phase:`,
    phaseLines(STUDENT_SCRIPT),
    "Anchor in THEIR concrete projects rather than hypotheticals wherever possible.",
    NON_NEGOTIABLES,
    CLOSING,
  ].join(" ");
}

// ---- Case-grounded scenario ----------------------------------------------------

/** One phase of a case-designed interview — the skeleton phase, with the
 *  case-grounded probes instantiated by devcase/interview_scenario.py. */
export type ScenarioPhase = StudentScriptPhase & {
  /** Which case element this instantiates (e.g. "tasks[0]", "coverProbes[p1]"); "" for personal phases. */
  caseRef?: string;
};

export type CaseInterviewScenario = {
  caseId?: string;
  roleTitle?: string;
  /** 1–2 minutes of narration introducing the shared case material to the candidate. */
  caseIntro: string;
  phases: ScenarioPhase[];
  durationMin: number;
};

export function scenarioRunOfShow(scenario: CaseInterviewScenario): string[] {
  return scenario.phases.map((p) => p.phase);
}

/** Pipeline entries sourced for a dev case carry jobId "dc-<caseId>"
 *  (devcase-orchestrator's proactive sourcing). Resolve it back to the dev case
 *  id — the key to the role's stored interview scenario — or null for ordinary
 *  jobs. */
export function devCaseIdFromJobId(jobId: string | null | undefined): string | null {
  return jobId && jobId.startsWith("dc-") ? jobId.slice(3) : null;
}

/** Entries promoted from an evaluated dev-case submission carry candidateId
 *  "ds-<submissionId>" (devcase-run.promoteSubmission). Resolve it back to the
 *  submission id — the key to the eval bundle whose minted interview follow-ups
 *  ground the submission-debrief brief — or null for ordinary candidates. */
export function submissionIdFromCandidateId(candidateId: string | null | undefined): string | null {
  return candidateId && candidateId.startsWith("ds-") ? candidateId.slice(3) : null;
}

/** The agent brief for a CASE-DESIGNED interview: same persona contract, but the
 *  middle phases work shared case material, so every candidate on the role is
 *  rated against the same substance. The case mechanics (which probes are
 *  scripted, what they reveal) are for the agent only — never disclosed. */
export function caseGroundedInterviewerInstructions(
  scenario: CaseInterviewScenario,
  opts?: { candidateLabel?: string | null; roleLine?: string | null; company?: string | null }
): string {
  const company = opts?.company || "Česká spořitelna";
  const role = opts?.roleLine || scenario.roleTitle || "a junior role (entry-eligible)";
  const name = opts?.candidateLabel ? ` You are speaking with ${opts.candidateLabel}.` : "";
  return [
    ...personaLines(company, role, name),
    `This interview is grounded in a short work scenario every candidate for the role hears, so answers are comparable. After your introduction, narrate it conversationally in at most two minutes: ${scenario.caseIntro}`,
    `Then lead the conversation through this run of show (about ${scenario.durationMin} minutes total), one question at a time, keeping each phase roughly time-boxed and adapting follow-ups to their answers — but cover every phase:`,
    phaseLines(scenario.phases),
    "The scenario's probes and hints are scripted for comparability — NEVER reveal that, and never imply the candidate is being tested on a specific trap. Phases about their own background stay personal; phases about the scenario stay on the shared material.",
    NON_NEGOTIABLES,
    CLOSING,
  ].join(" ");
}

// ---- Simulator fixture ---------------------------------------------------------

/** A small, clearly-synthetic scenario for the simulator's case-grounded lane —
 *  shaped exactly like devcase/interview_scenario.py output. Replaced by real
 *  generated scenarios once the Dev-cases lifecycle wires them per role. */
export const DEMO_CASE_SCENARIO: CaseInterviewScenario = {
  caseId: "demo-case",
  roleTitle: "Junior Backend Developer (entry-eligible)",
  caseIntro:
    "Order notifications: our shop sends customers an email when an order ships. Lately some customers get the email twice, and a few get it before the order has actually shipped. The service reads shipping events from a queue and sends mail through a third-party provider. We'd like to understand what could be wrong and how you'd approach making it reliable.",
  durationMin: STUDENT_SCRIPT_MIN,
  phases: STUDENT_SCRIPT.map((p) => {
    if (!p.caseGrounded) return { ...p };
    if (p.phase === "Mechanism probes") {
      return {
        ...p,
        probe:
          "“Why might the service read from a queue instead of being called directly when an order ships? What breaks first if the mail provider goes down for an hour?”",
        caseRef: "brief",
      };
    }
    if (p.phase === "Counterfactual & transfer") {
      return {
        ...p,
        probe:
          "“Same service, but now it's Black Friday — 100× the orders and the provider rate-limits us. What changes first in your approach?”",
        caseRef: "brief",
      };
    }
    // Coachability injection — the hint comes from the case's duplicate-delivery trap.
    return {
      ...p,
      probe:
        "Mid-discussion, offer ONE gentle hint: “Could the same shipping event ever arrive on the queue twice?” and observe whether they integrate it.",
      listenFor: "Do they connect the hint to the duplicate emails and reason toward idempotency, or acknowledge it and move on?",
      caseRef: "coverProbes[demo]",
    };
  }),
};
