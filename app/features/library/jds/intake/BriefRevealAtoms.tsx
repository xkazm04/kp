"use client";

import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "@/app/_lib/useReducedMotion";
import { classifyReveal, rememberKeys, typeStep, TYPE_TICK_MS, type RevealMode } from "./briefReveal";

// The client half of the reveal (briefReveal.ts holds the rules and the test).
// Two pieces, both shared by the prototype variants:
//
//   useBriefReveal  — the panel's memory of what it has already shown.
//   TypedText       — one line writing itself out.

// A separator no key can contain — keys carry normalized SENTENCES, so joining
// on a space would split "must:senior backend engineer" into phantom lines.
const KEY_SEP = "␟";

export type BriefReveal = {
  /** How this line should enter. Unknown key → `fade`: the very first paint
   *  happens BEFORE the classifying effect runs, and nothing on it is news. */
  mode: (key: string) => RevealMode;
  /** True while at least one line is still typing — the panel's own "the agent
   *  is writing" state. A timer, not a callback per line: a line that unmounts
   *  mid-type (the requestor opens the edit form) would otherwise never report
   *  itself finished and the indicator would stick forever. */
  writing: boolean;
};

export function useBriefReveal(keys: readonly string[]): BriefReveal {
  const seen = useRef<ReadonlySet<string> | null>(null);
  const [modes, setModes] = useState<Map<string, RevealMode>>(() => new Map());
  const [writing, setWriting] = useState(false);
  const signature = keys.join(KEY_SEP);

  useEffect(() => {
    // Rebuilt from the signature rather than closed over `keys`: the deps are
    // then honest (one primitive) with no suppressed lint rule, and a re-render
    // that produces the same lines cannot re-run the classification.
    const current = signature ? signature.split(KEY_SEP) : [];
    const next = classifyReveal(seen.current, current);
    seen.current = rememberKeys(seen.current, current);
    setModes(next);
    if (![...next.values()].includes("type")) {
      setWriting(false);
      return;
    }
    setWriting(true);
    const timer = window.setTimeout(() => setWriting(false), 1200);
    return () => window.clearTimeout(timer);
  }, [signature]);

  return { mode: (key: string) => modes.get(key) ?? "fade", writing };
}

/** A line that writes itself. `type` reveals character by character; `fade` is
 *  one linear opacity pass (`animate-arrive-in`, already reduced-motion gated in
 *  globals.css); `settled` renders flat — no animation at all, which is what
 *  keeps a re-extraction from flickering the whole panel.
 *
 *  Reduced motion collapses `type` to the finished string: a caret walking
 *  across the panel is exactly the kind of motion that preference asks us to
 *  stop. The text is always in the DOM in full for assistive tech — the
 *  partial string is `aria-hidden`, so a screen reader reads the sentence once,
 *  complete, instead of re-announcing it on every frame. */
export function TypedText({ text, mode, className }: { text: string; mode: RevealMode; className?: string }) {
  const reduced = useReducedMotion();
  const typing = mode === "type" && !reduced;
  const [shown, setShown] = useState(() => (typing ? 0 : text.length));

  // No synchronous setState here — not as style, but because the two cases that
  // would want one cannot happen: a line's key is DERIVED from its text, so new
  // text is a new element with a fresh initial `shown`, and `type` is only ever
  // assigned to a key on the render that mounts it. The non-typing branch below
  // ignores `shown` entirely, so there is nothing to reset either.
  useEffect(() => {
    if (!typing) return;
    const total = text.length;
    const step = typeStep(total);
    let at = 0;
    const timer = window.setInterval(() => {
      at = Math.min(total, at + step);
      setShown(at);
      if (at >= total) window.clearInterval(timer);
    }, TYPE_TICK_MS);
    return () => window.clearInterval(timer);
  }, [text, typing]);

  if (!typing) {
    return <span className={`${mode === "fade" ? "animate-arrive-in" : ""} ${className ?? ""}`}>{text}</span>;
  }
  return (
    <span className={className}>
      <span aria-hidden>{text.slice(0, shown)}</span>
      {shown < text.length ? (
        // A steady bar, not a blinking one: the caret already carries the
        // "being written" signal, and a blink is motion that never stops.
        <span className="ml-0.5 inline-block h-[0.9em] w-px translate-y-[0.1em] bg-coral" aria-hidden />
      ) : null}
      <span className="sr-only">{text}</span>
    </span>
  );
}
