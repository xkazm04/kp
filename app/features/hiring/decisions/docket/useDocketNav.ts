"use client";

// The Docket's levels: 0 the queue, 1 one role. A thin use of the kit's level stack
// (levelReduce / LevelTransition): the stack, the running transition, the opener each level must
// close back onto, and where focus goes after a move (the new level's heading on the way in, the
// element that was touched on the way out). Esc goes one level up, yielding to an open dialog and
// to a focused field. The URL is not involved: a level is a place you walked into, not an address.
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { levelReduce, type LevelEntry, type LevelRules, type TransitionKind } from "@/app/_components/kit/scene";
import { useReducedMotion } from "@/app/_lib/useReducedMotion";

export type DocketEntry = LevelEntry & { roleKey: string | null };
export type DocketStack = readonly DocketEntry[];

export const DOCKET_ROOT: DocketStack = [{ level: 0, roleKey: null }];
const RULES: LevelRules<DocketEntry> = { root: DOCKET_ROOT, same: (a, b) => a.level === b.level && a.roleKey === b.roleKey };

type Transition = { kind: "open" } | { kind: "close"; ghost: DocketEntry; opener: HTMLElement | null } | null;

export const topOf = (s: DocketStack): DocketEntry => s[s.length - 1];

function focusable(el: HTMLElement | null): el is HTMLElement {
  return el !== null && el.isConnected && el.getClientRects().length > 0 && !el.closest("[inert],[hidden]");
}

export function useDocketNav(rootRef: RefObject<HTMLElement | null>) {
  const reduced = useReducedMotion();
  const [stack, setStack] = useState<DocketStack>(DOCKET_ROOT);
  const [transition, setTransition] = useState<Transition>(null);
  const [opener, setOpener] = useState<HTMLElement | null>(null);
  const want = useRef<"heading" | "opener" | null>(null);
  const focusedFor = useRef<DocketStack | null>(null);

  const push = useCallback(
    (roleKey: string, el: HTMLElement | null = null) => {
      const next = levelReduce(stack, { type: "push", entry: { level: 1, roleKey } }, RULES);
      if (next === stack) return;
      want.current = "heading";
      setOpener(el);
      setStack(next);
      setTransition({ kind: "open" });
    },
    [stack],
  );

  const pop = useCallback(() => {
    if (stack.length < 2) return;
    want.current = "opener";
    setTransition({ kind: "close", ghost: topOf(stack), opener });
    setStack(levelReduce(stack, { type: "pop" }, RULES));
  }, [stack, opener]);

  const settle = useCallback(() => setTransition(null), []);

  // Focus follows every move after the first render (a tab that opens never steals focus).
  useEffect(() => {
    const first = focusedFor.current === null;
    const same = focusedFor.current === stack;
    focusedFor.current = stack;
    if (first || same) return;
    const root = rootRef.current;
    const w = want.current;
    want.current = null;
    if (!root) return;
    const top = root.querySelector<HTMLElement>(`.k-layer[data-depth="${stack.length - 1}"]:not([data-mode="leaving"])`);
    let target: HTMLElement | null = null;
    if (w === "opener") target = focusable(opener) ? opener : null;
    else {
      target = top?.querySelector<HTMLElement>("[data-level-heading]") ?? null;
      if (root.getBoundingClientRect().top < 0) root.scrollIntoView({ block: "start", behavior: reduced ? "auto" : "smooth" });
    }
    target?.focus({ preventScroll: w !== "opener" });
  }, [stack, rootRef, reduced, opener]);

  // Esc: one level up, unless a dialog is open (it owns Esc) or a field has focus.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || stack.length < 2) return;
      const a = document.activeElement;
      if (a instanceof HTMLElement && (a.matches("input, textarea, select, [contenteditable='true'], [role='combobox']") || a.closest("[role='dialog']"))) return;
      if (document.querySelector("[role='dialog'][aria-modal='true']")) return;
      e.preventDefault();
      pop();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stack, pop]);

  const kind: TransitionKind = transition?.kind ?? null;
  return { stack, transition, kind, opener, push, pop, settle };
}
