"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { TransitionKind } from "@/app/_components/kit/scene";
import { useReducedMotion } from "@/app/_lib/useReducedMotion";
import { WORKFORCE_ROOT, depthOf, topOf, workforceReduce, type WorkforceEntry, type WorkforceStack } from "./workforceNav";

type Transition =
  | { kind: "open" | "swap" }
  /** The level on its way out, drawn over the new top until the circle has closed. */
  | { kind: "close"; ghost: WorkforceEntry; ghostDepth: number; opener: HTMLElement | null; from: WorkforceStack }
  | null;

/** Where focus goes after a move: the new level's heading, a returning opener, or the control with the same `data-level-key`. */
type FocusWant = { to: "heading" } | { to: "opener"; el: HTMLElement | null } | { to: "key"; key: string } | null;

function focusable(el: HTMLElement | null): el is HTMLElement {
  return el !== null && el.isConnected && el.getClientRects().length > 0 && !el.closest("[inert],[hidden]");
}

/**
 * The workforce's navigation: the level stack (workforceNav.workforceReduce), the running transition,
 * the opener each level must close back onto, and focus after every move. The same shape as the Night
 * Post's hook (hiring/channels/night/useChannelsNightNav.ts) without its URL inbox: Hiring > Agents
 * has no deep link into a level.
 */
export function useWorkforceNav(rootRef: RefObject<HTMLElement | null>) {
  const reduced = useReducedMotion();
  const [stack, setStack] = useState<WorkforceStack>(WORKFORCE_ROOT);
  const [transition, setTransition] = useState<Transition>(null);
  // openers[d] = the element that opened the level at depth d (state, not a ref: layers read it).
  const [openers, setOpeners] = useState<readonly (HTMLElement | null)[]>([]);
  const focusWant = useRef<FocusWant>(null);
  // The stack focus last followed: a first render (or StrictMode's second effect run) is not a move.
  const focusedFor = useRef<WorkforceStack | null>(null);

  const push = useCallback(
    (entry: WorkforceEntry, opener: HTMLElement | null = null) => {
      const next = workforceReduce(stack, { type: "push", entry });
      if (next === stack) return;
      focusWant.current = { to: "heading" };
      setStack(next);
      if (next.length <= stack.length) {
        // A place already on the stack: a return, not a descent. No circle to draw from.
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
      const next = workforceReduce(stack, { type: "popTo", depth });
      if (next.length === stack.length) return;
      const opener = openers[next.length] ?? null;
      focusWant.current = { to: "opener", el: opener };
      setStack(next);
      setTransition(transition ? null : { kind: "close", ghost: topOf(stack), ghostDepth: depthOf(stack), opener, from: stack });
    },
    [stack, transition, openers],
  );

  const pop = useCallback(() => popTo(depthOf(stack) - 1), [popTo, stack]);

  const replaceTop = useCallback(
    (entry: WorkforceEntry) => {
      const next = workforceReduce(stack, { type: "replaceTop", entry });
      if (next === stack) return;
      const key = document.activeElement instanceof HTMLElement ? document.activeElement.dataset.levelKey : undefined;
      focusWant.current = key ? { to: "key", key } : { to: "heading" };
      setStack(next);
      setTransition({ kind: "swap" });
    },
    [stack],
  );

  const settle = useCallback(() => setTransition(null), []);

  // Focus follows every move after the first render (a tab that opens never steals focus).
  useEffect(() => {
    const first = focusedFor.current === null;
    const same = focusedFor.current === stack;
    focusedFor.current = stack;
    if (first || same) return;
    const root = rootRef.current;
    const want = focusWant.current;
    focusWant.current = null;
    if (!root) return;
    const top = root.querySelector<HTMLElement>(`.k-layer[data-depth="${depthOf(stack)}"]:not([data-mode="leaving"])`);
    const heading = () => top?.querySelector<HTMLElement>("[data-level-heading]") ?? null;
    let target: HTMLElement | null = null;
    if (want?.to === "opener") {
      target = focusable(want.el) ? want.el : heading();
    } else if (want?.to === "key") {
      target = top?.querySelector<HTMLElement>(`[data-level-key="${want.key}"]`) ?? heading();
    } else {
      target = heading();
      // A level opens at the top of the surface: bring it into view when the reader had scrolled past.
      if (root.getBoundingClientRect().top < 0) root.scrollIntoView({ block: "start", behavior: reduced ? "auto" : "smooth" });
    }
    target?.focus({ preventScroll: want?.to !== "opener" });
  }, [stack, rootRef, reduced]);

  const kind: TransitionKind = transition?.kind ?? null;
  return { stack, transition, kind, openers, push, pop, popTo, replaceTop, settle };
}
