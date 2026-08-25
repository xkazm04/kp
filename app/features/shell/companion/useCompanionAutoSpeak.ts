"use client";

import { useEffect, useRef } from "react";
import type { CompanionSpeakableTurn, CompanionSpeech } from "./useCompanionSpeech";

/*
 * "Read new replies aloud" (round V2's second setting) — the one caller of
 * `speech.speak` that no one pressed.
 *
 * `useCompanionSpeech` was written for exactly this: speak is imperative and
 * fire-and-forget, holds no state of its own, and supersedes whatever was
 * playing. So this hook owns ONE question and nothing else: which reply is NEW.
 *
 * PRIMING is the whole subtlety. Opening the dock hydrates a stored thread, so
 * the last answer in the list on the first render is not new — it may be a week
 * old — and speaking it would be the app talking at an operator who has just
 * arrived. So the first pass records the newest id and says nothing; only a
 * CHANGE after that is an arrival. The same rule makes turning the setting on
 * silent: priming has already happened, so nothing speaks until she next
 * answers.
 *
 * A NEW CONVERSATION is deliberately not re-primed. Starting one empties the
 * list, the newest id becomes null, and the next real answer is a change from
 * null — which is correct: that answer genuinely just arrived.
 *
 * EXPECT `blocked`. Browsers refuse audio a user gesture did not ask for, and an
 * auto-speak is by construction the case with no gesture behind it. That is not
 * handled here, because it cannot be: unblocking must run FROM a gesture. It is
 * handled where the gesture is — the playback control renders `blocked` as a
 * resume affordance (CompanionSpeakButton's contract, V1).
 */

/** A speakable turn that also says whose it is — the projection this hook needs
 *  and `CompanionTurn` already satisfies. Declared here rather than widened in
 *  V1's type, because `role` is this hook's question, not the speech seam's. */
export type AutoSpeakTurn = CompanionSpeakableTurn & { role: string };

export function useCompanionAutoSpeak(
  enabled: boolean,
  turns: readonly AutoSpeakTurn[],
  /** Only `speak` is taken, and only because it is the stable half of the hook:
   *  the speech object itself is a fresh literal every render, so depending on
   *  it would re-run this effect on every keystroke in the composer. */
  speak: CompanionSpeech["speak"]
): void {
  const seen = useRef<string | null>(null);
  const primed = useRef(false);

  useEffect(() => {
    const latest = lastAssistant(turns);
    const id = latest?.id ?? null;
    if (!primed.current) {
      primed.current = true;
      seen.current = id;
      return;
    }
    if (id === seen.current) return;
    seen.current = id;
    if (!enabled || !latest) return;
    speak(latest);
  }, [turns, enabled, speak]);
}

/** The newest assistant turn, or null. An optimistic user bubble is not one, so
 *  typing never counts as an arrival. */
function lastAssistant(turns: readonly AutoSpeakTurn[]): AutoSpeakTurn | null {
  for (let i = turns.length - 1; i >= 0; i--) {
    if (turns[i].role === "assistant") return turns[i];
  }
  return null;
}
