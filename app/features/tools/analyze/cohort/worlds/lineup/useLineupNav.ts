"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { TransitionKind } from "@/app/_components/kit/scene";
import { useReducedMotion } from "@/app/_lib/useReducedMotion";
import type { CohortDimension } from "../../cohortTypes";
import { cellKey, parseCellKey } from "./lineupGrid";
import { STREET_ROWS } from "./lineupModel";
import { LINEUP_ROOT, depthOf, floorOf, lineupReduce, stairDirection, topOf, type LineupEntry, type LineupStack } from "./lineupNav";

export type LineupTransition =
  | { kind: "open"; floor: CohortDimension }
  /** The floor on its way out, drawn over the street until the corridor has closed back into its band. */
  | { kind: "close"; floor: CohortDimension; ghost: LineupEntry; ghostDepth: number; from: LineupStack }
  | { kind: "swap"; dir: 1 | -1 }
  | null;

type FocusWant = { to: "heading" } | { to: "opener"; el: HTMLElement | null; floor: CohortDimension | null } | { to: "key"; key: string } | null;

function focusable(el: HTMLElement | null): el is HTMLElement {
  return el !== null && el.isConnected && el.getClientRects().length > 0 && !el.closest("[inert],[hidden]");
}

/**
 * The Line-up's navigation: the level stack (lineupNav.lineupReduce), the running corridor, the element
 * each level must close back onto, and focus after every move. A push focuses the floor's heading; a pop
 * focuses the opener, moved to the floor you walked out of (else that floor's directory entry, else the
 * street's headline); a stair step keeps
 * focus on the control with the same `data-level-key`. The first render takes no focus. Nothing is
 * written to the URL: the world is a prototype mounted by the studio.
 */
export function useLineupNav(rootRef: RefObject<HTMLElement | null>) {
  const reduced = useReducedMotion();
  const [stack, setStack] = useState<LineupStack>(LINEUP_ROOT);
  const [transition, setTransition] = useState<LineupTransition>(null);
  const [openers, setOpeners] = useState<readonly (HTMLElement | null)[]>([]);
  const focusWant = useRef<FocusWant>(null);
  const focusedFor = useRef<LineupStack | null>(null);

  const push = useCallback(
    (entry: LineupEntry, opener: HTMLElement | null) => {
      const next = lineupReduce(stack, { type: "push", entry });
      if (next === stack) return;
      focusWant.current = { to: "heading" };
      setStack(next);
      setOpeners((prev) => Object.assign([...prev], { [next.length - 1]: opener }));
      setTransition(entry.level === 1 && next.length > stack.length ? { kind: "open", floor: entry.dimension } : null);
    },
    [stack],
  );

  const pop = useCallback(() => {
    const next = lineupReduce(stack, { type: "pop" });
    if (next.length === stack.length) return;
    const floor = floorOf(stack);
    const opener = openers[stack.length - 1] ?? null;
    focusWant.current = { to: "opener", el: opener, floor };
    setStack(next);
    setTransition(floor ? { kind: "close", floor, ghost: topOf(stack), ghostDepth: depthOf(stack), from: stack } : null);
  }, [stack, openers]);

  /** The stairs: another floor at the same level, sliding in from the side it lies on. */
  const toFloor = useCallback(
    (dimension: CohortDimension) => {
      const from = floorOf(stack);
      if (!from || from === dimension) return;
      const top = topOf(stack);
      const next = lineupReduce(stack, { type: "replaceTop", entry: { level: 1, dimension, focus: top.level === 1 ? top.focus : null } });
      const key = document.activeElement instanceof HTMLElement ? document.activeElement.dataset.levelKey : undefined;
      focusWant.current = key ? { to: "key", key } : { to: "heading" };
      setStack(next);
      setTransition({ kind: "swap", dir: stairDirection(from, dimension) });
    },
    [stack],
  );

  /** Re-aim the floor's focus on a member (or none): not a move, so no transition and no focus change. */
  const setFocusMember = useCallback((memberId: string | null) => {
    setStack((s) => {
      const top = topOf(s);
      if (top.level !== 1 || top.focus === memberId) return s;
      return [...s.slice(0, -1), { ...top, focus: memberId }];
    });
  }, []);

  const settle = useCallback(() => setTransition(null), []);

  useEffect(() => {
    const first = focusedFor.current === null;
    const same = focusedFor.current === stack;
    focusedFor.current = stack;
    const want = focusWant.current;
    if (first || same || !want) return;
    focusWant.current = null;
    const root = rootRef.current;
    if (!root) return;
    const top = root.querySelector<HTMLElement>(`.k-layer[data-depth="${depthOf(stack)}"]:not([data-mode="leaving"])`);
    const heading = () => top?.querySelector<HTMLElement>("[data-level-heading]") ?? null;
    let target: HTMLElement | null;
    if (want.to === "opener") {
      // Back on the street in front of the same building, on the floor you walked out of (the stairs may
      // have moved you since you went in): the opener itself when the floor is the one it opened.
      const from = parseCellKey(want.el?.dataset.luCell);
      const row = want.floor ? STREET_ROWS.indexOf(want.floor) : -1;
      const same = from && row >= 0 && from.row !== row ? top?.querySelector<HTMLElement>(`[data-lu-cell="${cellKey({ row, col: from.col })}"]`) ?? null : null;
      const opener = same ?? want.el;
      target = focusable(opener) ? opener : (want.floor ? top?.querySelector<HTMLElement>(`.lu-dir__floor[data-row="${want.floor}"]`) : null) ?? heading();
    } else if (want.to === "key") {
      target = top?.querySelector<HTMLElement>(`[data-level-key="${want.key}"]`) ?? heading();
    } else {
      target = heading();
      if (root.getBoundingClientRect().top < 0) root.scrollIntoView({ block: "start", behavior: reduced ? "auto" : "smooth" });
    }
    target?.focus({ preventScroll: want.to !== "opener" });
  }, [stack, rootRef, reduced]);

  const kind: TransitionKind = transition?.kind ?? null;
  const walking = transition?.kind === "open" || transition?.kind === "close" ? transition.floor : null;
  return { stack, transition, kind, walking, openers, push, pop, toFloor, setFocusMember, settle };
}
