"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { TransitionKind } from "@/app/_components/kit/scene";
import { LOOM_ROOT, loomReduce, topOf, type LoomEntry, type LoomStack } from "./loomNav";

export type LoomTransition =
  /** A row is being pulled out: `opener` is the spool or knot that was pressed (the ghost starts there). */
  | { kind: "open"; opener: HTMLElement | null }
  /** The page is folding back into its row; `ghost` is the level on its way out, drawn over the loom. */
  | { kind: "close"; ghost: LoomEntry; ghostDepth: number; opener: HTMLElement | null }
  /** A sideways step to the row above (-1) or below (+1). */
  | { kind: "swap"; dir: 1 | -1 }
  | null;

type FocusWant = { to: "heading" } | { to: "opener"; el: HTMLElement | null; dimension: string | null } | { to: "key"; key: string } | null;

function focusable(el: HTMLElement | null): el is HTMLElement {
  return el !== null && el.isConnected && el.getClientRects().length > 0 && !el.closest("[inert],[hidden]");
}

/**
 * The Loom's navigation: the level stack (loomNav.loomReduce over the kit's levelStack), the running
 * transition the pull choreography reads (useLoomPull), the element each level must fold back onto,
 * and focus after every move: a pull focuses the page's heading, a return focuses the knot or spool
 * that was pressed (else that row's spool), a sideways step keeps the control with the same
 * `data-level-key`. The first render never takes focus. No URL: the cohort studio owns its inbox.
 */
export function useLoomNav(rootRef: RefObject<HTMLElement | null>) {
  const [stack, setStack] = useState<LoomStack>(LOOM_ROOT);
  const [transition, setTransition] = useState<LoomTransition>(null);
  const [openers, setOpeners] = useState<readonly (HTMLElement | null)[]>([]);
  const focusWant = useRef<FocusWant>(null);
  const focusedFor = useRef<LoomStack | null>(null);

  const push = useCallback(
    (entry: LoomEntry, opener: HTMLElement | null) => {
      const next = loomReduce(stack, { type: "push", entry });
      if (next === stack) return;
      focusWant.current = { to: "heading" };
      setStack(next);
      if (next.length <= stack.length) {
        setTransition(null);
        return;
      }
      setOpeners((prev) => Object.assign([...prev], { [next.length - 1]: opener }));
      setTransition(transition ? null : { kind: "open", opener });
    },
    [stack, transition],
  );

  const popTo = useCallback(
    (depth: number) => {
      const next = loomReduce(stack, { type: "popTo", depth });
      if (next.length === stack.length) return;
      const gone = stack[next.length];
      const opener = openers[next.length] ?? null;
      focusWant.current = { to: "opener", el: opener, dimension: gone?.level === 1 ? gone.dimension : null };
      setStack(next);
      setTransition(transition ? null : { kind: "close", ghost: topOf(stack), ghostDepth: stack.length - 1, opener });
    },
    [stack, transition, openers],
  );

  const pop = useCallback(() => popTo(stack.length - 2), [popTo, stack]);

  const replaceTop = useCallback(
    (entry: LoomEntry, dir: 1 | -1) => {
      const next = loomReduce(stack, { type: "replaceTop", entry });
      if (next === stack) return;
      const key = document.activeElement instanceof HTMLElement ? document.activeElement.dataset.levelKey : undefined;
      focusWant.current = key ? { to: "key", key } : { to: "heading" };
      setStack(next);
      setTransition({ kind: "swap", dir });
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
    if (!root) return;
    const top = root.querySelector<HTMLElement>(`.k-layer[data-depth="${stack.length - 1}"]:not([data-mode="leaving"])`);
    const heading = () => top?.querySelector<HTMLElement>("[data-level-heading]") ?? null;
    let target: HTMLElement | null;
    if (want?.to === "opener") {
      target = focusable(want.el) ? want.el : (top?.querySelector<HTMLElement>(`.lm-spool[data-loom-row="${want.dimension}"]`) ?? heading());
    } else if (want?.to === "key") {
      target = top?.querySelector<HTMLElement>(`[data-level-key="${want.key}"]`) ?? heading();
    } else {
      target = heading();
      if (root.getBoundingClientRect().top < 0) root.scrollIntoView({ block: "start" });
    }
    target?.focus({ preventScroll: want?.to !== "opener" });
  }, [stack, rootRef]);

  const kind: TransitionKind = transition?.kind ?? null;
  return { stack, transition, kind, openers, push, pop, popTo, replaceTop, settle };
}
