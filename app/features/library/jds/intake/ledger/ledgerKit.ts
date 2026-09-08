// THE LEDGER LANE — the intake history, read in the studio's own language.
//
// The studio's two new coats agreed on one rule and this surface inherits it:
// NO SENTENCE OCCUPIES LAYOUT. What a control means lives in its tooltip; what a
// number means is drawn rather than spelled. This file is the JSX-free half —
// the vocabulary, the marks and the derivations — so the plane, the dossier and
// the doors can render the SAME record without importing one another.
//
// The metaphor: a session is a RUN. It ran for a while (the ticks), it was of a
// kind (the gutter mark), and it ended somewhere (the terminal mark). Every
// piece of the page is one of those three facts drawn in the same hand.

import type { IntakeSummary } from "../jdsIntakeLogic";

/** House spring — the same one the console coat's rail moves on. */
export const LEDGER_SPRING = { type: "spring" as const, stiffness: 420, damping: 34 };
/** Arrival stagger, in ms, and the row after which it stops paying for itself. */
export const LEDGER_STAGGER_MS = 40;
export const LEDGER_STAGGER_CAP = 12;

/** Catalog keys for the three intake shapes (the vocabulary the table already had). */
export const SHAPE_KEY = {
  power_unit: "shape.powerUnit",
  story: "shape.story",
  app_master: "shape.appMaster",
} as const;

/** The gutter mark's hue per shape. Colour is the KIND of run, never its state. */
export const SHAPE_HUE: Record<keyof typeof SHAPE_KEY, string> = {
  power_unit: "bg-ink",
  story: "bg-steel",
  app_master: "bg-coral",
};

export const LEDGER_STATUSES = ["open", "complete", "promoted"] as const;
export type LedgerStatus = (typeof LEDGER_STATUSES)[number];

/** How the terminal mark is DRAWN — an outcome, never a word in a pill.
 *
 *  `open`      an empty ring: the slot the outcome will land in (the console
 *              rail draws the current exchange exactly this way).
 *  `complete`  a filled mark: the run finished and produced a brief.
 *  `promoted`  a filled coral square: the run produced a JD, and the mark is
 *              the door to it.
 */
export const STATUS_MARK: Record<LedgerStatus, string> = {
  open: "h-2.5 w-2.5 rounded-full border border-coral",
  complete: "h-2.5 w-2.5 rounded-full bg-ink",
  promoted: "h-2.5 w-2.5 rounded-sm bg-coral",
};

/** Ticks drawn for a conversation of `turns`, and whether the run overflows the
 *  rail. Beyond the cap the eye stops counting anyway, so the tail becomes a
 *  bare tabular numeral rather than forty dots that mean "many". */
export const TICK_CAP = 14;

export function tickRun(turns: number): { ticks: number; overflow: number } {
  const safe = Number.isFinite(turns) && turns > 0 ? Math.floor(turns) : 0;
  return { ticks: Math.min(safe, TICK_CAP), overflow: Math.max(0, safe - TICK_CAP) };
}

/** The row the dossier describes: whatever the reader last opened, else the
 *  most recently touched. Pure, so the rail's rule is testable rather than
 *  asserted inside a component. */
export function highlightRow(sessions: readonly IntakeSummary[] | null, lastOpened: string | null): IntakeSummary | null {
  if (!sessions || sessions.length === 0) return null;
  const picked = lastOpened ? sessions.find((s) => s.id === lastOpened) : null;
  if (picked) return picked;
  return [...sessions].sort((a, b) => (b.updatedAt ?? b.createdAt).localeCompare(a.updatedAt ?? a.createdAt))[0] ?? null;
}
