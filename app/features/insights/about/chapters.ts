import type { SceneChapter } from "./stage/Scene";

/*
 * The six mechanisms this deck explains.
 *
 * Scope note: the previous About tab was a 24-item capability browser with a
 * PlantUML diagram per item — an internal architecture reference. This deck
 * replaces it with six chapters chosen because each one is a decision a reader
 * would otherwise have to take on trust: how a role gets written, how a person
 * gets a number, who gets filtered and by what, how "kinds of candidate" are
 * handled without one rule flattening them, what a work sample proves in an
 * era when anyone can delegate it, and where a human must still decide.
 *
 * Copy discipline, borrowed from the reference this deck is modelled on:
 * `eyebrow` is the category (2-3 words), `title` is the CLAIM the scene makes,
 * `lede` is the mechanism in two or three sentences. Everything else is
 * diegetic — it lives inside the art, as a real label on a real part. No
 * caption ever explains an animation.
 *
 * Every number and stage name in here is quoted from the running code. Where a
 * chapter states a threshold, that threshold is a constant somewhere in
 * `pipeline/jobfit/` or `app/_lib/` — the deck is only worth building if it
 * stays true, so treat these strings as coupled to those constants.
 */

export const CHAPTERS: readonly SceneChapter[] = [
  {
    id: "job-descriptions",
    n: 1,
    eyebrow: "Job descriptions",
    title: "Three passes, and nothing invented",
    lede:
      "You tick what should be built, and an unticked step never spawns a process. One pass reads your need against the real codebase and reports where they disagree; a second turns it into requirements that must trace back to something actually stated; a third prices the band from the open web. The last two run side by side — and the document itself is assembled in code, not written by the model.",
    tab: "library",
    tabLabel: "Open Job descriptions",
  },
  {
    id: "scoring",
    n: 2,
    eyebrow: "Candidate scoring",
    title: "Five ceilings that sum to one hundred",
    lede:
      "A CV becomes five components with fixed maxima — Experience 25, Skills 30, Role 23, Education 12, Traits 10 — and the total is always their sum. The model's own claimed total is never trusted; it is kept only as a divergence signal. Matching a person to a job is a different engine again: a cheap knock-out filter first, then a weighted sum that shows its own confidence band.",
    tab: "analyze",
    tabLabel: "Open Analyze",
  },
  {
    id: "screening",
    n: 3,
    eyebrow: "Screening",
    title: "Cheap filters first, expensive judgement last",
    lede:
      "Screening is ordered by cost. Hard gates run on everyone, a deterministic scorer runs on whoever survives, and the model is asked to reason only about the shortlist that reaches the top. Nothing that costs money runs on a candidate who was already ruled out.",
    tab: "pipeline",
    tabLabel: "Open Overview",
  },
  {
    id: "archetypes",
    n: 4,
    eyebrow: "Archetypes",
    title: "The same three slots, weighted differently",
    lede:
      "A student and a fifteen-year veteran cannot be ranked by one rule without one of them losing unfairly. So a candidate is routed to an archetype, and the archetype changes what the three scoring dimensions mean: for early-career profiles, Career becomes Potential and Personal becomes Fit. Two of the three archetypes are fairness-protected and can never be auto-rejected.",
    tab: "archetypes",
    tabLabel: "Open Archetypes",
  },
  {
    id: "assignments",
    n: 5,
    eyebrow: "Assignments",
    title: "A work sample that survives being delegated",
    lede:
      "Anyone can hand a take-home to a model. So the case is built to be informative even then: it carries deliberate under-specification, traps that punish confident guessing, and a mid-flight change that arrives after the work has started. What is graded is the reasoning the candidate shows, not whether the answer compiles.",
    tab: "assignments",
    tabLabel: "Open Assignments",
  },
  {
    id: "human-gates",
    n: 6,
    eyebrow: "Human gates",
    title: "The machine ranks, a person decides",
    lede:
      "Every action that reaches a candidate passes a person first. The system's job is to arrive at that moment with the evidence assembled and the reasoning written down — what was scored, on what basis, and what it was not confident about — so the decision a human makes is recorded as theirs.",
    tab: "decisions",
    tabLabel: "Open Decisions",
  },
] as const;
