// The three rules the live transcript log got wrong, as pure functions.
//
// 1. AUTOSCROLL. The effect ran `el.scrollTop = el.scrollHeight` on EVERY append,
//    unconditionally. A candidate who scrolled up to re-read the question they are
//    answering was yanked back to the bottom the moment the next transcription
//    landed — mid-call, with no way to hold their place. Follow the tail only while
//    the reader is already AT the tail.
// 2. KEYS. Turns were keyed by their index in the RENDERED list. With the fold
//    below, an index in the visible slice is not a stable identity at all (turn #7
//    becomes #1 the moment folding starts), and React would reuse the wrong DOM
//    node. Keys are built from the turn's position in the FULL transcript, which is
//    append-only and therefore never re-numbers.
// 3. GROWTH. The log grew without bound: a long interview mounts every turn, and
//    `role="log" aria-live="polite"` makes each one an announcement. Render a
//    window of the most recent turns and say, in words, how many are folded above —
//    the full transcript is persisted server-side and shown on the scorecard, so
//    nothing is lost, and the candidate is told rather than quietly trimmed.

import type { VoiceTurn } from "@/app/_lib/voice/types";

/** How close to the bottom still counts as "reading the live tail". A few pixels of
 *  slack, because fractional scroll heights (zoom, sub-pixel line boxes) mean an
 *  element scrolled fully to the bottom rarely reports an exact 0 remainder. */
export const FOLLOW_SLACK_PX = 48;

/** How many turns the live log renders. Beyond this the oldest are folded behind a
 *  counted line. Sized for a long screening call's tail (~40 exchanges) — well under
 *  the persistence cap in app/_lib/interview-transcript.ts, which is the record. */
export const MAX_VISIBLE_TURNS = 80;

/** Should the log jump to the newest turn? Only when the reader was already parked
 *  at the bottom — otherwise they scrolled up deliberately and we leave them there.
 *  Pure (no DOM), so the rule is testable without a browser. */
export function shouldFollow(scrollTop: number, scrollHeight: number, clientHeight: number): boolean {
  // A log shorter than its box has nothing to scroll: always "at the bottom".
  if (scrollHeight <= clientHeight) return true;
  return scrollHeight - clientHeight - scrollTop <= FOLLOW_SLACK_PX;
}

/** A turn plus its index in the FULL transcript — the stable identity a key needs. */
export type PlacedTurn = { turn: VoiceTurn; index: number };

export type FoldedTranscript = {
  /** The turns to render, newest last, each carrying its full-transcript index. */
  visible: PlacedTurn[];
  /** How many older turns are folded above (0 when everything fits). */
  folded: number;
};

/** Window the transcript to its most recent `max` turns. */
export function foldTranscript(turns: VoiceTurn[], max: number = MAX_VISIBLE_TURNS): FoldedTranscript {
  const start = Math.max(0, turns.length - max);
  return {
    visible: turns.slice(start).map((turn, i) => ({ turn, index: start + i })),
    folded: start,
  };
}

/** A React key that survives folding, re-renders and a locale switch. The index is
 *  the position in the append-only full transcript; `at` disambiguates the (possible
 *  but harmless) case of a transcript being replaced wholesale by a retry. */
export function turnKey(placed: PlacedTurn): string {
  return `${placed.index}:${placed.turn.at ?? ""}`;
}
