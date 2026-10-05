"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { useSearchParams } from "next/navigation";
import { buildUrl } from "@/app/features/shell/tabs";
import { useShellNavigate } from "@/app/features/shell/nav/shallow-nav";
import { shouldEmptyInbox } from "@/app/features/shell/nav/urlInbox";
import type { TransitionKind } from "@/app/_components/kit/scene";
import { useReducedMotion } from "@/app/_lib/useReducedMotion";
import {
  NIGHT_PARAM, NIGHT_ROOT, channelOf, depthOf, nightReduce, parseNightArrival, topOf,
  type NightEntry, type NightStack,
} from "./channelsNightNav";

type Transition =
  | { kind: "open" | "swap" }
  /** The level on its way out, drawn over the new top until the circle has closed. */
  | { kind: "close"; ghost: NightEntry; ghostDepth: number; opener: HTMLElement | null; from: NightStack }
  | null;

/** Where focus goes after a move: the new level's heading, a returning opener (else the
 *  building of the level that closed), or the control that has the same `data-level-key`. */
type FocusWant = { to: "heading" } | { to: "opener"; el: HTMLElement | null; node: string | null } | { to: "key"; key: string } | null;

function focusable(el: HTMLElement | null): el is HTMLElement {
  return el !== null && el.isConnected && el.getClientRects().length > 0 && !el.closest("[inert],[hidden]");
}

/**
 * The Night Post's navigation: the level stack (channelsNightNav.nightReduce), the running
 * transition, the openers each level must close back onto, focus after every move, and the
 * `?sec=` inbox. The URL is a one-shot ARRIVAL, as everywhere in the workspace
 * (docs/architecture/app-structure.md "The view selectors are app state; the URL is their
 * inbox"): an arriving value builds the whole stack it names, the param is emptied at once,
 * and clicking writes nothing. The adoption follows urlInbox.ts' rules: once per appearance,
 * during render, an absent or unknown value changes nothing.
 */
export function useChannelsNightNav(rootRef: RefObject<HTMLElement | null>) {
  const search = useSearchParams();
  const shellNav = useShellNavigate();
  const reduced = useReducedMotion();
  const incoming = search.get(NIGHT_PARAM);
  const [stack, setStack] = useState<NightStack>(() => parseNightArrival(incoming) ?? NIGHT_ROOT);
  const [seen, setSeen] = useState<string | null>(incoming);
  const [transition, setTransition] = useState<Transition>(null);
  // openers[d] = the element that opened the level at depth d (state, not a ref: layers read it).
  const [openers, setOpeners] = useState<readonly (HTMLElement | null)[]>([]);
  const focusWant = useRef<FocusWant>(null);
  // The stack focus last followed: a first render (or StrictMode's second effect run) is not a move.
  const focusedFor = useRef<NightStack | null>(null);

  if (incoming !== seen) {
    setSeen(incoming);
    const arrived = parseNightArrival(incoming);
    if (arrived) {
      setStack(arrived);
      setTransition(null);
    }
  }
  useEffect(() => {
    if (shouldEmptyInbox(incoming)) shellNav.replace(buildUrl({ [NIGHT_PARAM]: null }, search.toString()));
  }, [incoming, shellNav, search]);

  const push = useCallback(
    (entry: NightEntry, opener: HTMLElement | null = null) => {
      const next = nightReduce(stack, { type: "push", entry });
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
      const next = nightReduce(stack, { type: "popTo", depth });
      if (next.length === stack.length) return;
      const firstGone = stack[next.length];
      const opener = openers[next.length] ?? null;
      const owner = channelOf(firstGone);
      focusWant.current = { to: "opener", el: opener, node: owner };
      setStack(next);
      setTransition(transition ? null : { kind: "close", ghost: topOf(stack), ghostDepth: depthOf(stack), opener, from: stack });
    },
    [stack, transition, openers],
  );

  const pop = useCallback(() => popTo(depthOf(stack) - 1), [popTo, stack]);

  const replaceTop = useCallback(
    (entry: NightEntry) => {
      const next = nightReduce(stack, { type: "replaceTop", entry });
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
      target = focusable(want.el) ? want.el : top?.querySelector<HTMLElement>(`[data-night-node="${want.node}"]`) ?? heading();
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
