// The guided walk's CHAPTER SEQUENCING, extracted from useSimulationWalk so it can
// be read and tested without React, a router, a DOM or a server.
//
// useSimulationWalk was 464 lines with no test, and the three things most worth
// pinning were the three most deeply buried in it: which chapters run and in what
// order, when a chapter is allowed to halt the whole run, and what happens when a
// real click cannot find its button. All three are pure decisions about data; only
// the awaits around them are not.
//
// What deliberately stays in the hook: the copy (it needs a translator), the fetches
// and the beats. This module is structure — ids, tabs, selectors, timings, halt
// reasons and the click route.
import { SIM_PHASES, type SimPhaseId } from "./constants";

/** One chapter of the scripted run: where it navigates, what it spotlights, and how
 *  long it lets the viewer read before and after the action. The copy is resolved by
 *  the hook from the `simulation` namespace against the same `id`. */
export type SimChapter = {
  id: SimPhaseId;
  tab: string;
  /** The element the spotlight lands on. `#main` where the chapter is about the
   *  whole surface rather than one control. */
  target: string;
  readMs?: number;
  settleMs?: number;
};

/** The seven chapters, in order. The ids and tabs MUST agree with SIM_PHASES — that
 *  list drives the phase strip the viewer watches, and a walk that navigated
 *  somewhere else than the strip claimed was the drift this pins. */
export const SIM_CHAPTERS: readonly SimChapter[] = [
  { id: "design", tab: "library", target: '[data-sim="jd-builder"]', readMs: 2200 },
  { id: "source", tab: "jobs", target: '[data-sim="job-drafts"]' },
  { id: "match", tab: "channels", target: '[data-sim="channel-inbound"]' },
  { id: "screen", tab: "analytics", target: "#main", readMs: 1800 },
  { id: "interview", tab: "schedule", target: '[data-sim="schedule"]', readMs: 1500 },
  { id: "offer", tab: "decisions", target: '[data-sim="decisions"]', settleMs: 1200 },
  { id: "hired", tab: "pipeline", target: '[data-sim="pipeline-board"]', readMs: 1200, settleMs: 1400 },
];

/** The chapter by id. Throws rather than returning undefined: a missing chapter is a
 *  programming error, and a silently-skipped one would leave the run narrating a
 *  phase it never walked. */
export function simChapter(id: SimPhaseId): SimChapter {
  const found = SIM_CHAPTERS.find((c) => c.id === id);
  if (!found) throw new Error(`unknown sim chapter: ${id}`);
  return found;
}

/** How a scripted interaction actually reached the app.
 *
 *  Every "click" in the walk is a real DOM click on a rendered control — that is the
 *  demo's whole claim, and it is what makes the tour a product test rather than a
 *  video. When the control is not on screen within the wait, the walk falls back to
 *  the API call the button would have made. That fallback is legitimate, but it was
 *  INVISIBLE: the run log said only "the draft wasn't visible" and then narrated the
 *  outcome exactly as if a person had clicked. A viewer could not tell a working
 *  surface from a broken one that the engine papered over. */
export type SimClickRoute = "dom" | "api";

export function clickRoute(clicked: boolean): SimClickRoute {
  return clicked ? "dom" : "api";
}

/** The reasons a chapter may end the whole run. Each is a broken PRECONDITION for
 *  the next chapter, never a cosmetic failure: continuing past one of these is how
 *  the walk used to reach a cryptic timeout three steps later instead of saying what
 *  went wrong where it went wrong. */
export const SIM_HALT_REASONS = ["noScreened", "offerTokenMissing"] as const;
export type SimHaltReason = (typeof SIM_HALT_REASONS)[number];

/** After the match chapter: the run follows ONE candidate, so a cohort that produced
 *  nobody in the screened column has nothing to follow. */
export function matchHalt(top: { id: string } | undefined | null): SimHaltReason | null {
  return top ? null : "noScreened";
}

/** After the offer chapter: the hired chapter opens the candidate's real offer page
 *  by token, so a missing token means there is no page to open. */
export function offerHalt(token: string | undefined | null): SimHaltReason | null {
  return token ? null : "offerTokenMissing";
}

/** The invariant SIM_CHAPTERS owes SIM_PHASES, exposed so the test states it once
 *  and the module can be read without cross-referencing constants.ts. */
export function chaptersMatchPhases(): boolean {
  return (
    SIM_CHAPTERS.length === SIM_PHASES.length &&
    SIM_CHAPTERS.every((c, i) => c.id === SIM_PHASES[i].id && c.tab === SIM_PHASES[i].tab)
  );
}
