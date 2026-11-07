// The sheet stack of the /one layout (SheetsLayout.tsx) — pure, so the rules are pinned by stack.test.ts.
//
//   list sheets    letters (the drafts waiting) · calendar (the week + who waits)
//   person sheets  profile · letter · schedule — bound to ONE candidate (the selection, or the
//                  person the answer named), so a press on another row swaps their person
//
// At most MAX_STACK sheets are kept; the top two are drawn (the lower one peeks at its
// edge). Esc pops one. A new answer resets the stack to the sheet that answers it.
import type { TargetAndTransition, Transition } from "framer-motion";
import type { PanelKind } from "../types";
import type { MotionSpec, OneMotionPresets } from "../motion";

export const SHEET_KINDS = ["letters", "calendar", "profile", "letter", "schedule"] as const;
export type SheetKind = (typeof SHEET_KINDS)[number];

const PERSON: readonly SheetKind[] = ["profile", "letter", "schedule"];
export const isPersonSheet = (k: SheetKind | undefined): boolean => k !== undefined && PERSON.includes(k);

/** The panels a sheet draws — the side never repeats them as its table. */
export const SHEET_PANELS: readonly PanelKind[] = ["letters", "calendar", "profile", "letter"];

export const MAX_STACK = 3;
export const VISIBLE = 2;

/** Where the pick that changed the selection came from. */
export type PickSource = "side" | "letters" | "calendar" | null;

/** Push a sheet: already on top → unchanged; already below → the stack is cut back to it;
 *  past MAX_STACK the bottom one goes. */
export function push(stack: readonly SheetKind[], kind: SheetKind): SheetKind[] {
  if (stack.at(-1) === kind) return [...stack];
  const at = stack.indexOf(kind);
  if (at >= 0) return stack.slice(0, at + 1);
  return [...stack, kind].slice(-MAX_STACK);
}

export function pop(stack: readonly SheetKind[]): SheetKind[] {
  return stack.slice(0, -1);
}

/** Cut the stack back so `index` is the top (a breadcrumb press). */
export function popTo(stack: readonly SheetKind[], index: number): SheetKind[] {
  return stack.slice(0, Math.max(0, index) + 1);
}

/** A candidate was picked. From the letters sheet → their letter; from the calendar → the
 *  calendar stays (the pick is who to book); anywhere else → the top person sheet swaps its
 *  person, or their profile opens. */
export function onPick(stack: readonly SheetKind[], src: PickSource): SheetKind[] {
  const top = stack.at(-1);
  if (src === "calendar") return [...stack];
  if (src === "letters") {
    const at = stack.indexOf("letters");
    return at >= 0 ? push(stack.slice(0, at + 1), "letter") : push(stack, "letter");
  }
  if (isPersonSheet(top) || top === "calendar") return [...stack];
  if (top === "letters") return push(stack, src === "side" ? "profile" : "letter");
  return ["profile"];
}

/** The selection was cleared: the person sheets go, the list sheets stay. */
export function onClear(stack: readonly SheetKind[]): SheetKind[] {
  return stack.filter((k) => !isPersonSheet(k));
}

/** The sheet that answers an answer whose primary view is `kind` (none → no sheet). */
export function forAnswer(kind: PanelKind | undefined): SheetKind[] {
  switch (kind) {
    case "letters":
      return ["letters"];
    case "calendar":
      return ["calendar"];
    case "profile":
      return ["profile"];
    case "letter":
      return ["letter"];
    default:
      return [];
  }
}

/** Profile and calendar need half the screen (CV | score, the week beside who waits). */
export function isWide(stack: readonly SheetKind[]): boolean {
  return stack.includes("profile") || stack.includes("calendar");
}

/** The sheet slide — built from the core snap preset (its transition, its offset scaled to a
 *  sheet's travel): in from the column's edge, out the same way. Reduced motion is the root
 *  MotionConfig's (the slide's transform drops, the fade stays) — no second still form here. */
export const SHEET_TRAVEL = 6;
export function sheetEnter(m: Pick<OneMotionPresets, "answerSwap">): MotionSpec {
  const base = m.answerSwap(-1);
  const from = base.initial !== false && typeof base.initial.x === "number" ? base.initial.x : 0;
  const x = from * SHEET_TRAVEL;
  const leave: TargetAndTransition = { opacity: 0, x, transition: base.exit?.transition as Transition | undefined };
  return { initial: { opacity: 0, x }, animate: { opacity: 1, x: 0 }, exit: leave, transition: base.transition };
}

/** The lower sheet's spine arriving with a push (and leaving with the pop): a short slide in
 *  from the column edge, the same pace as the sheet. */
export function spineEnter(m: Pick<OneMotionPresets, "answerSwap">): MotionSpec {
  const base = m.answerSwap(-1);
  return { initial: { opacity: 0, x: -8 }, animate: { opacity: 1, x: 0 }, exit: { opacity: 0, x: -8, transition: base.exit?.transition as Transition | undefined }, transition: base.transition };
}
