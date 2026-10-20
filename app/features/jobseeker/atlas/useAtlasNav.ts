"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { TransitionKind } from "@/app/_components/kit/scene";
import { useReducedMotion } from "@/app/_lib/useReducedMotion";
import { atlasReduce, depthOf, topOf, type AtlasEntry, type AtlasStack } from "./atlasNav";

type Transition =
  | { kind: "open" | "swap" }
  /** The level on its way out, drawn over the new top until the circle has closed. */
  | { kind: "close"; ghost: AtlasEntry; ghostDepth: number; opener: HTMLElement | null; from: AtlasStack }
  | null;

/** Where focus goes after a move: the new level's heading, or back onto the thing that opened it. */
type FocusWant = { to: "heading" } | { to: "opener"; el: HTMLElement | null } | null;

function focusable(el: HTMLElement | null): el is HTMLElement {
  return el !== null && el.isConnected && el.getClientRects().length > 0 && !el.closest("[inert],[hidden]");
}

/**
 * The Atlas's navigation: the level stack (atlasNav.atlasReduce), the running transition, the
 * opener each level closes back onto, and focus after every move. The Night Post's hook
 * (hiring/channels/night/useChannelsNightNav.ts) is the model; the Atlas has no URL inbox beyond
 * the deep link it is handed as `initial`, and clicking writes nothing to the URL.
 */
export function useAtlasNav(rootRef: RefObject<HTMLElement | null>, initial: AtlasStack) {
  const reduced = useReducedMotion();
  const [stack, setStack] = useState<AtlasStack>(initial);
  const [transition, setTransition] = useState<Transition>(null);
  // openers[d] = the element that opened the level at depth d (state, not a ref: layers read it).
  const [openers, setOpeners] = useState<readonly (HTMLElement | null)[]>([]);
  const focusWant = useRef<FocusWant>(null);
  const focusedFor = useRef<AtlasStack | null>(null);

  const push = useCallback(
    (entry: AtlasEntry, opener: HTMLElement | null = null) => {
      const next = atlasReduce(stack, { type: "push", entry });
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
      const next = atlasReduce(stack, { type: "popTo", depth });
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
    (entry: AtlasEntry) => {
      const next = atlasReduce(stack, { type: "replaceTop", entry });
      if (next === stack) return;
      focusWant.current = { to: "heading" };
      setStack(next);
      setTransition({ kind: "swap" });
    },
    [stack],
  );

  const settle = useCallback(() => setTransition(null), []);

  // Focus follows every move after the first render (a page that opens never steals focus).
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
    let target: HTMLElement | null;
    if (want?.to === "opener") {
      target = focusable(want.el) ? want.el : heading() ?? root.querySelector<HTMLElement>("[data-role=hub-heading]");
    } else {
      target = heading();
      if (root.getBoundingClientRect().top < 0) root.scrollIntoView({ block: "start", behavior: reduced ? "auto" : "smooth" });
    }
    target?.focus({ preventScroll: want?.to !== "opener" });
  }, [stack, rootRef, reduced]);

  const kind: TransitionKind = transition?.kind ?? null;
  return { stack, transition, kind, openers, push, pop, popTo, replaceTop, settle };
}
