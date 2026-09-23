// The guided walk's scripted interactions, as MOVES: what to click, and how the run
// knows the click did the work.
//
// Every "click" in the walk is a real DOM click on a rendered control; that is the
// demo's whole claim (simWalkSteps.ts). A click used to be judged by one bit, "was the
// element found", and two of the four broke inside a week with no gate or log
// noticing: the Publish button started opening a terms dialog (the click "succeeded",
// no fallback ran, the walk sourced nobody and walked on), and offer rows lost their
// quick-accept (the climactic Send-offer click timed out and fell back on every run).
//
// A move is judged by its EFFECT on the board instead: click every anchor in order,
// wait for the board to show the change, and only then call it a DOM success. A click
// that landed but changed nothing, or a control that never appeared, falls back to the
// checked API call that does the same work, and the board is read again. The run log
// names the route and the reason; a refused fallback halts with the server's code,
// and a fallback the board still does not show halts rather than narrating an outcome
// that did not happen.
//
// Not "door": in this feature a door is the server-side sim GATE (SimDoorState,
// app/api/sim/sim-door-contract.test.ts). A move is the client's scripted interaction.
//
// Pure: the engine's move() (useSimulationEngine.ts) owns the awaits.
import { stageHasRole, type StageDef } from "@/app/_lib/pipeline-stages";
import { isSimTitle } from "./constants";

export const SIM_MOVE_IDS = ["publish", "confirmSlot", "offerSend", "offerAccept"] as const;
export type SimMoveId = (typeof SIM_MOVE_IDS)[number];

/** Where an anchor is looked up: inside the subject's `data-sim-entry` row, inside the
 *  open dialog the previous click raised, or in the candidate page's sim iframe. */
export type SimMoveScope = "entry" | "dialog" | "frame";

/** One click of a move. `file` is the product file that must render the anchor; the
 *  test reads it, so an anchor that vanishes in a refactor is red before a demo runs. */
export type SimMoveClick = { anchor: string; scope: SimMoveScope; file: string };

export type SimMove = { id: SimMoveId; clicks: readonly SimMoveClick[] };

export const SIM_MOVES: Readonly<Record<SimMoveId, SimMove>> = {
  // The draft row's Publish opens the go-live terms (target hires, languages); the
  // publish itself is the dialog's confirm.
  publish: {
    id: "publish",
    clicks: [
      { anchor: "publish", scope: "entry", file: "app/features/library/jobs/JobsDraftsPanel.tsx" },
      { anchor: "publish-confirm", scope: "dialog", file: "app/features/library/jobs/JobsPublishDialog.tsx" },
    ],
  },
  // The recruiter confirms the proposed interview slot on the shared calendar.
  confirmSlot: {
    id: "confirmSlot",
    clicks: [{ anchor: "confirm", scope: "entry", file: "app/features/hiring/schedule/ScheduleTabPendingList.tsx" }],
  },
  // An offer row has no quick-accept (the deadline is chosen in the candidate modal),
  // so the walk opens the ledger's third door and sends the offer from the modal.
  offerSend: {
    id: "offerSend",
    clicks: [
      { anchor: "decide", scope: "entry", file: "app/features/hiring/decisions/ledger/LedgerCells.tsx" },
      { anchor: "accept", scope: "dialog", file: "app/features/hiring/pipeline/candidate/decision/CandidateDecisionBar.tsx" },
    ],
  },
  // The candidate accepts on their own offer page.
  offerAccept: {
    id: "offerAccept",
    clicks: [{ anchor: "offer-accept", scope: "frame", file: "app/offer/[token]/OfferClient.tsx" }],
  },
};

/** The CSS selector for one click, against the move's subject id. */
export function moveSelector(click: SimMoveClick, subjectId: string): string {
  const anchor = `[data-sim-click="${click.anchor}"]`;
  if (click.scope === "entry") return `[data-sim-entry="${subjectId}"] ${anchor}`;
  if (click.scope === "dialog") return `[role="dialog"] ${anchor}`;
  return anchor;
}

/** How a move actually reached the app. */
export type SimMoveRoute = "dom" | "api";
/** Why a move fell back: the control never appeared, or it was clicked and the board
 *  did not change. */
export type SimMoveReason = "notVisible" | "noEffect";
/** A halt is a server's machine code, or one of the move's own reasons. */
export type SimMoveOutcome = { route: SimMoveRoute; reason: SimMoveReason | null; halt: string | null };

export type SimMoveObservation = {
  /** Every anchor of the move was found and clicked. */
  clicked: boolean;
  /** The board showed the effect within the wait after the clicks. */
  effectAfterClick?: boolean;
  /** The fallback's subject is a (SIM) row. Absent = not checked (true). */
  simSubject?: boolean;
  /** The API fallback answered 2xx. Absent = never ran. */
  apiOk?: boolean;
  /** The machine code a refused fallback answered with. */
  apiCode?: string | null;
  /** The board showed the effect after the fallback. */
  effectAfterApi?: boolean;
};

/** The route a move took and whether the run must stop. Total over every observation:
 *  a fallback that never ran is a refusal, never a pass. */
export function moveOutcome(o: SimMoveObservation): SimMoveOutcome {
  if (o.clicked && o.effectAfterClick) return { route: "dom", reason: null, halt: null };
  const reason: SimMoveReason = o.clicked ? "noEffect" : "notVisible";
  // The fallback writes through a real route, so it may only ever touch the demo
  // corpus; the same answer the server-side sim gate gives a real entry.
  if (o.simSubject === false) return { route: "api", reason, halt: "SIM_ENTRY_NOT_FOUND" };
  if (!o.apiOk) return { route: "api", reason, halt: o.apiCode || "moveFailed" };
  if (!o.effectAfterApi) return { route: "api", reason, halt: "moveNoEffect" };
  return { route: "api", reason, halt: null };
}

/** The fallback gate: a subject whose job title does not carry the (SIM) marker is not
 *  the walk's to write. */
export function simSubject(jobTitle: string | null | undefined): boolean {
  return isSimTitle(jobTitle);
}

/** The run is Hired only when the followed entry sits on this board's terminal-role
 *  stage, resolved from the live axis (a composed board may rename the column). */
export function hiredEffect(entry: { stage: string } | null | undefined, axis: readonly StageDef[]): boolean {
  return !!entry && stageHasRole(entry.stage, "terminal", axis);
}

/** What the walk records per chapter: which route each chapter's move took and why. */
export type SimMoveLog = Partial<Record<SimMoveId, { route: SimMoveRoute; reason: SimMoveReason | null }>>;
