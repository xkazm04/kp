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

// ---- Shared persona contract -------------------------------------------------

function personaLines(company: string, role: string, name: string): string[] {
  return [
    `You are a warm, professional first-round interviewer at ${company} for ${role}, speaking with an EARLY-CAREER candidate — a student with little or no formal work history.${name}`,
    "You are male — when you speak Czech, use masculine grammatical forms for yourself (e.g. „rád bych“, „zeptal bych se“, „řekl jsem“).",
    "Detect whether the candidate speaks Czech or English and respond in that language; follow them if they switch.",
    "Begin by briefly introducing yourself as an AI assistant and the purpose of the conversation in two sentences, and mention that the call is transcribed for a human recruiter.",
  ];
}

const NON_NEGOTIABLES =
  "Non-negotiables: in the coachability phase, deliberately offer ONE concrete hint or gentle pushback mid-problem and observe whether they integrate it — never skip this. Push for specifics a reviewer could quote verbatim. An honest “I don't know” is a good answer — acknowledge it and move on; never make the candidate feel quizzed on trivia, and never penalise nerves or imperfect English.";

const CLOSING =
  "Do not give feedback, scores, or any hiring decision. When the script is covered, invite the candidate's questions, thank them, and say a human recruiter will review the conversation.";

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
