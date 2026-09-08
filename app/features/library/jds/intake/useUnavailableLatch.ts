"use client";

import { useState } from "react";
import { latchUnavailable } from "./intakeVoiceIo";

/*
 * "This install cannot do that" — remembered, for one component's life.
 *
 * The rule itself is pure and tested (intakeVoiceIo.latchUnavailable); this is
 * only the React half, and it exists as its own file because BOTH voice
 * pipelines need it and neither may import the other. Dictation and read-aloud
 * degrade independently, and a shared module is how that stays true without one
 * hook reaching into the other's file.
 *
 * ADJUSTED DURING RENDER, not in an effect. The sticky answer is a function of a
 * value that arrives as state from the package hook, and the previous-value
 * comparison below is React's documented shape for exactly that ("You might not
 * need an effect" → adjusting state when a prop changes): it re-renders once,
 * before anything is painted, instead of painting a live control for a frame and
 * then retracting it.
 */
export function useUnavailableLatch(code: string | null, unavailableCode: string): boolean {
  const [latched, setLatched] = useState(false);
  const [seen, setSeen] = useState<string | null>(code);
  if (seen !== code) {
    setSeen(code);
    setLatched((current) => latchUnavailable(current, code, unavailableCode));
  }
  return latched;
}
