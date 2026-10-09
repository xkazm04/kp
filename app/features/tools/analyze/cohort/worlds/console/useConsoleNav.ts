"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { useReducedMotion } from "@/app/_lib/useReducedMotion";
import type { CohortDimension } from "../../cohortTypes";
import { CONSOLE_ROOT, consoleReduce, stepBus, topOf, type ConsoleEntry, type ConsoleStack } from "./consoleNav";

export type SoloTransition =
  | { kind: "open" }
  | { kind: "swap"; dir: 1 | -1 }
  /** The soloed bus on its way out, drawn over the desk until its band has closed. */
  | { kind: "close"; ghost: ConsoleEntry; ghostDepth: number; opener: HTMLElement | null; from: ConsoleStack }
  | null;

type FocusWant = { to: "heading" } | { to: "opener"; el: HTMLElement | null; bus: CohortDimension | null } | { to: "key"; key: string } | null;

const focusable = (el: HTMLElement | null): el is HTMLElement =>
  el !== null && el.isConnected && el.getClientRects().length > 0 && !el.closest("[inert],[hidden]");

/**
 * The desk's navigation: the level stack (consoleNav), the running solo transition, the element
 * each level must close back onto, and focus after every move: a solo focuses the level's heading,
 * a return focuses the opener (else that bus's SOLO key), a sideways step keeps the control with
 * the same `data-level-key`. `refocus` changes the soloed bus's focused channel without a transition.
 * The first render never takes focus. No URL: the studio owns the tab's inbox.
 */
export function useConsoleNav(rootRef: RefObject<HTMLElement | null>) {
  const reduced = useReducedMotion();
  const [stack, setStack] = useState<ConsoleStack>(CONSOLE_ROOT);
  const [transition, setTransition] = useState<SoloTransition>(null);
  const [openers, setOpeners] = useState<readonly (HTMLElement | null)[]>([]);
  const focusWant = useRef<FocusWant>(null);
  const focusedFor = useRef<ConsoleStack | null>(null);

  const push = useCallback(
    (entry: ConsoleEntry, opener: HTMLElement | null) => {
      const next = consoleReduce(stack, { type: "push", entry });
      if (next === stack) return;
      focusWant.current = { to: "heading" };
      setStack(next);
      if (next.length <= stack.length) {
        setTransition(null);
        return;
      }
      setOpeners((prev) => Object.assign([...prev], { [next.length - 1]: opener }));
      setTransition(transition ? null : { kind: "open" });
    },
    [stack, transition],
  );

  const popTo = useCallback(
    (depth: number) => {
      const next = consoleReduce(stack, { type: "popTo", depth });
      if (next.length === stack.length) return;
      const gone = stack[next.length];
      const opener = openers[next.length] ?? null;
      focusWant.current = { to: "opener", el: opener, bus: gone && gone.level === 1 ? gone.dimension : null };
      setStack(next);
      setTransition(transition ? null : { kind: "close", ghost: topOf(stack), ghostDepth: stack.length - 1, opener, from: stack });
    },
    [stack, transition, openers],
  );

  const pop = useCallback(() => popTo(stack.length - 2), [popTo, stack.length]);

  const go = useCallback(
    (dimension: CohortDimension, dir: 1 | -1) => {
      const top = topOf(stack);
      if (top.level !== 1 || top.dimension === dimension) return;
      const next = consoleReduce(stack, { type: "replaceTop", entry: { level: 1, dimension, focus: top.focus } });
      if (next === stack) return;
      const key = document.activeElement instanceof HTMLElement ? document.activeElement.dataset.levelKey : undefined;
      focusWant.current = key ? { to: "key", key } : { to: "heading" };
      setStack(next);
      setTransition({ kind: "swap", dir });
    },
    [stack],
  );

  const step = useCallback(
    (delta: 1 | -1) => {
      const top = topOf(stack);
      if (top.level === 1) go(stepBus(top.dimension, delta), delta);
    },
    [stack, go],
  );

  const refocus = useCallback(
    (focus: string | null) => {
      const top = topOf(stack);
      if (top.level !== 1 || top.focus === focus) return;
      focusedFor.current = null; // not a move: focus stays where the reader put it
      setStack(consoleReduce(stack, { type: "replaceTop", entry: { ...top, focus } }));
    },
    [stack],
  );

  const settle = useCallback(() => setTransition(null), []);

  useEffect(() => {
    const first = focusedFor.current === null;
    const same = focusedFor.current === stack;
    focusedFor.current = stack;
    if (first || same) return;
    const root = rootRef.current;
    const want = focusWant.current;
    focusWant.current = null;
    if (!root || !want) return;
    const top = root.querySelector<HTMLElement>(`.cx-layer[data-depth="${stack.length - 1}"]:not([data-mode="leaving"])`);
    const heading = () => top?.querySelector<HTMLElement>("[data-level-heading]") ?? null;
    let target: HTMLElement | null;
    if (want.to === "opener") {
      target = focusable(want.el) ? want.el : top?.querySelector<HTMLElement>(`[data-solo-key="${want.bus}"]`) ?? null;
    } else if (want.to === "key") {
      target = top?.querySelector<HTMLElement>(`[data-level-key="${want.key}"]`) ?? heading();
    } else {
      target = heading();
      if (root.getBoundingClientRect().top < 0) root.scrollIntoView({ block: "start", behavior: reduced ? "auto" : "smooth" });
    }
    target?.focus({ preventScroll: want.to !== "opener" });
  }, [stack, rootRef, reduced]);

  return { stack, transition, openers, push, pop, popTo, go, step, refocus, settle };
}
