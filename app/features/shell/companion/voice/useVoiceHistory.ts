"use client";

import { useCallback, useMemo, useState, type KeyboardEvent } from "react";
import {
  clampVoiceIndex,
  latestVoiceIndex,
  nextVoicePosition,
  stepVoiceIndex,
  voiceEntries,
  type VoiceEntry,
  type VoiceSourceTurn,
} from "./voiceHistory";

/*
 * The reader's place in the conversation, for the voice pair.
 *
 * NO EFFECT, and that is the design. The position is DERIVED every render from
 * (the entries, what the reader is holding) — so a reply landing while the
 * operator sits on answer 3 does not need an effect to notice, decide and
 * re-set; it simply renders as "3 of 18" instead of "3 of 17". Every earlier
 * shape of this hook had a `useEffect(… setIndex …)`, and every one of them had
 * the same bug: the effect ran after the paint, so a new reply flashed the old
 * answer's text under the new answer's counter for one frame.
 *
 * What IS state is the intent — which answer the operator asked to see, and
 * whether they are still at the end of the conversation. `pinned` is not
 * `index === last`: those two agree until the moment a reply lands, and the
 * whole point is that a pinned reader moves with it while an unpinned one does
 * not, even though both were pointing at the same entry a tick earlier.
 */
export type VoiceHistory = {
  entries: VoiceEntry[];
  /** The answer on screen, or null while the thread has none. */
  entry: VoiceEntry | null;
  /** Zero-based; -1 when there is nothing to show. */
  index: number;
  total: number;
  /** One-based, for the "3 of 17" indicator. 0 when there is nothing. */
  position: number;
  canOlder: boolean;
  canNewer: boolean;
  older: () => void;
  newer: () => void;
  /** Jump to an absolute position (the mini-timeline's dots). The clamp and the
   *  pin live here and nowhere else — a caller that computed its own index would
   *  be a second place for both to be wrong. Out-of-range is a no-op, not a
   *  throw: a dot for an answer a reconcile has just removed is a stale click,
   *  not an error the operator did anything about. */
  goTo: (index: number) => void;
  /** ArrowLeft / ArrowRight while the header window has focus. Bound to the
   *  region rather than the document: a global key handler would steal the
   *  arrows from the composer, from a select, and from the page behind — and
   *  this surface deliberately leaves the page usable. */
  onKeyDown: (event: KeyboardEvent) => void;
};

export function useVoiceHistory(turns: readonly VoiceSourceTurn[]): VoiceHistory {
  const entries = useMemo(() => voiceEntries(turns), [turns]);
  // What the reader asked for, not where they ended up. `null` + pinned is the
  // opening state: nothing held, follow the newest.
  const [held, setHeld] = useState<{ id: string | null; pinned: boolean }>({ id: null, pinned: true });

  const total = entries.length;
  const index = nextVoicePosition(entries, held);
  const entry = index >= 0 ? entries[index] : null;

  const goTo = useCallback(
    (next: number) => {
      const target = clampVoiceIndex(entries.length, next);
      if (target < 0) return;
      setHeld({ id: entries[target].id, pinned: target === latestVoiceIndex(entries.length) });
    },
    [entries]
  );

  const older = useCallback(() => goTo(stepVoiceIndex(entries.length, index, -1)), [goTo, entries.length, index]);
  const newer = useCallback(() => goTo(stepVoiceIndex(entries.length, index, 1)), [goTo, entries.length, index]);

  const onKeyDown = useCallback(
    (event: KeyboardEvent) => {
      // The window region can contain controls that OWN the arrow keys — round
      // V2's direction switcher was a radiogroup with roving tabindex, and the
      // settings popover anchored in the chrome can hold a segmented control or
      // a select. They preventDefault but do not stop the event, so without this
      // guard pressing Right inside one would both move that control and jump
      // the reader forward a turn.
      const target = event.target as HTMLElement | null;
      if (target?.closest?.("input, textarea, select, [role='radiogroup'], [contenteditable='true']")) return;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        older();
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        newer();
      }
    },
    [older, newer]
  );

  return {
    entries,
    entry,
    index,
    total,
    position: index >= 0 ? index + 1 : 0,
    canOlder: index > 0,
    canNewer: index >= 0 && index < total - 1,
    older,
    newer,
    goTo,
    onKeyDown,
  };
}
