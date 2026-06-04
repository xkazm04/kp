// The canonical early-career interview thought-script — ONE source for:
//   * the About tab visualization (StudentsAbout → Interview script),
//   * the simulator's run-of-show sidebar (InterviewSimTab),
//   * the agent brief that actually LEADS the conversation
//     (studentInterviewerInstructions, used by /api/interview/simulate and —
//     next — by /api/interview/create for early-career entries).
//
// The order is deliberate: concrete → mechanism → counterfactual → metacognitive,
// with a DELIBERATE hint injection mid-script — coachability only exists live;
// no take-home can capture it. Each phase names the early-career rubric
// competencies it feeds (the exact interview-rubrics.json names), so the script
// visibly covers every construct the scorecard will rate.

export type StudentScriptPhase = {
  phase: string;
  minutes: string;
  goal: string;
  probe: string;
  listenFor: string;
  /** Early-career rubric competencies this phase feeds (interview-rubrics.json names). */
  feeds: string[];
};

export const STUDENT_SCRIPT: StudentScriptPhase[] = [
  {
    phase: "Anchor on their ground",
    minutes: "3–4 min",
    goal: "Start where they are strongest — their own project — to get a truthful baseline, not a rehearsed pitch.",
    probe: "“Walk me through the project you're proudest of. What exactly was yours?”",
    listenFor: "Ownership language (“I decided” vs “we were told”); specifics over buzzwords.",
    feeds: ["Communication & collaboration", "Motivation & direction"],
  },
  {
    phase: "Mechanism probes",
    minutes: "4–5 min",
    goal: "Move from what they built to WHY it works — the difference between understanding and recall.",
    probe: "“Why X over Y? What breaks first if we remove Z?”",
    listenFor: "Causal reasoning about their own choices; honest “I don't know” over confabulation.",
    feeds: ["Conceptual depth", "Problem decomposition"],
  },
  {
    phase: "Counterfactual & transfer",
    minutes: "4–5 min",
    goal: "Change one constraint and watch whether the knowledge generalises or was memorised.",
    probe: "“Same system, but the data is 100× bigger — what changes first?”",
    listenFor: "Re-decomposition under the new constraint, not a recited pattern.",
    feeds: ["Conceptual depth", "Problem decomposition"],
  },
  {
    phase: "Coachability injection",
    minutes: "3–4 min",
    goal: "Deliberately offer a hint or gentle pushback mid-problem — the one signal no take-home can capture.",
    probe: "“Have you considered the case where the input arrives out of order?”",
    listenFor: "Hint uptake: integrate and build on it (5) vs acknowledge and ignore (2). Score the uptake, not the answer.",
    feeds: ["Coachability", "Learning agility"],
  },
  {
    phase: "Stuck-and-recovered",
    minutes: "3–4 min",
    goal: "Surface the learning loop — how they behave when nothing works is the best ramp-up predictor we have.",
    probe: "“Where did you get hardest stuck? Walk me through getting out.”",
    listenFor: "A repeatable diagnose–experiment–adjust loop; reflection on what they'd do differently.",
    feeds: ["Learning agility"],
  },
  {
    phase: "Calibration & direction",
    minutes: "3–4 min",
    goal: "Test self-awareness: have them rate themselves, then probe the rating; close on where they want to go.",
    probe: "“Rate your SQL 1–10. What would someone one point above you know that you don't?”",
    listenFor: "Calibrated self-assessment (knowing the shape of what they don't know); intrinsic, specific direction.",
    feeds: ["Motivation & direction", "Coachability"],
  },
];

/** Honest total for the scripted screen — the phases above sum to ~20–25 minutes. */
export const STUDENT_SCRIPT_MIN = 22;

/** Candidate-facing agenda titles (the sidebar run-of-show). */
export function studentRunOfShow(): string[] {
  return STUDENT_SCRIPT.map((p) => p.phase);
}

/** The simulator's "regular candidate" lane: the standard ungrounded quick screen
 *  (defaultInterviewerInstructions) with a matching candidate-facing agenda. */
export const REGULAR_DEMO_RUN_OF_SHOW = ["Recent experience", "Depth follow-ups", "Your questions"];

/** The agent brief that LEADS a student first-round per the script above.
 *  Mirrors the persona contract of the grounded brief (interview-run.composeBrief):
 *  AI disclosure + transcription note, Czech/English detection, no feedback or
 *  decisions — plus the early-career non-negotiables (deliberate hint injection,
 *  quotable specifics, "I don't know" is a good answer). */
export function studentInterviewerInstructions(opts?: {
  candidateLabel?: string | null;
  roleLine?: string | null;
  company?: string | null;
}): string {
  const company = opts?.company || "Česká spořitelna";
  const role = opts?.roleLine || "a junior engineering role (entry-eligible)";
  const name = opts?.candidateLabel ? ` You are speaking with ${opts.candidateLabel}.` : "";
  const phases = STUDENT_SCRIPT.map(
    (p, i) => `${i + 1}. ${p.phase} (${p.minutes}) — ${p.goal} Ask: ${p.probe} Listen for: ${p.listenFor}`
  ).join("  ");
  return [
    `You are a warm, professional first-round interviewer at ${company} for ${role}, speaking with an EARLY-CAREER candidate — a student with little or no formal work history.${name}`,
    "You are male — when you speak Czech, use masculine grammatical forms for yourself (e.g. „rád bych“, „zeptal bych se“, „řekl jsem“).",
    "Detect whether the candidate speaks Czech or English and respond in that language; follow them if they switch.",
    "Begin by briefly introducing yourself as an AI assistant and the purpose of the conversation in two sentences, and mention that the call is transcribed for a human recruiter.",
    `Their CV cannot carry the evaluation, so YOU lead the conversation to generate the signal. Follow this run of show (about ${STUDENT_SCRIPT_MIN} minutes total), one question at a time, keeping each phase roughly time-boxed and adapting follow-ups to their answers — but cover every phase:`,
    phases,
    "Non-negotiables: in the coachability phase, deliberately offer ONE concrete hint or gentle pushback mid-problem and observe whether they integrate it — never skip this. Anchor in THEIR concrete projects rather than hypotheticals wherever possible. Push for specifics a reviewer could quote verbatim. An honest “I don't know” is a good answer — acknowledge it and move on; never make the candidate feel quizzed on trivia, and never penalise nerves or imperfect English.",
    "Do not give feedback, scores, or any hiring decision. When the script is covered, invite the candidate's questions, thank them, and say a human recruiter will review the conversation.",
  ].join(" ");
}
