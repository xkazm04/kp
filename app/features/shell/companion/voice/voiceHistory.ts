// The voice pair's reading model — PURE. No React, no DOM; runs under
// `node --test` via the alias loader (the `CompanionTurnMeta` import is
// type-only and erased).
//
// Voice mode shows ONE answer at a time, and the arrows walk the ones before it.
// So the transcript has to be projected into the thing the header actually
// paginates: her ANSWERS, in order, each carrying the question it answered.
//
// Three decisions live here rather than in a component, because all three are
// off-by-one traps and none of them is worth re-deriving per variant:
//
//   1. WHAT is an entry. Assistant turns only — a user message is not something
//      that can be replayed, and counting it would make "3 of 17" mean nothing
//      an operator could check against what they see.
//   2. WHICH question a reply belongs to. The nearest user turn BEFORE it in the
//      list, which is the only join available: turns carry no reply-to id, and
//      pairing by position breaks the moment a thread opens with a greeting or
//      carries two consecutive assistant turns (a proposal follow-up).
//   3. WHERE the index may point. A thread grows under the reader; a clamp that
//      is applied at one call site and forgotten at the next is how a header
//      ends up rendering "0 of 4" or reading `undefined`.

import type { CompanionTurnMeta } from "@/app/_lib/db/companion";

/** The shape this module needs from a turn — structural rather than
 *  `CompanionTurn`, so a leaner projection (a test, a preview) still works. */
export type VoiceSourceTurn = {
  id: string;
  role: string;
  content: string;
  meta?: CompanionTurnMeta | null;
};

/** One answer, ready to be shown, spoken and navigated. */
export type VoiceEntry = {
  id: string;
  content: string;
  meta: CompanionTurnMeta | null;
  /** The operator's own message that produced this answer, or null when there
   *  is none (she spoke first, or the pairing genuinely has no question). */
  prompt: string | null;
};

/** Her answers, oldest first — so index+1 reads as "the Nth thing she said",
 *  which is what an operator counting backwards through a conversation expects. */
export function voiceEntries(turns: readonly VoiceSourceTurn[]): VoiceEntry[] {
  const out: VoiceEntry[] = [];
  let lastPrompt: string | null = null;
  for (const turn of turns) {
    if (turn.role === "user") {
      const text = turn.content.trim();
      // An empty user turn cannot be the question a reply is labelled with, so
      // it does not displace the one before it.
      if (text) lastPrompt = text;
      continue;
    }
    if (turn.role !== "assistant") continue;
    out.push({ id: turn.id, content: turn.content, meta: turn.meta ?? null, prompt: lastPrompt });
  }
  return out;
}

/** The last index of a list, or -1 when there is nothing to point at. */
export function latestVoiceIndex(total: number): number {
  return total > 0 ? total - 1 : -1;
}

/** Any number -> an index this list can be read at. -1 for an empty list, which
 *  is the one value every consumer already has to handle (nothing to show). */
export function clampVoiceIndex(total: number, index: number): number {
  if (total <= 0) return -1;
  if (!Number.isFinite(index)) return latestVoiceIndex(total);
  const whole = Math.trunc(index);
  if (whole < 0) return 0;
  return Math.min(whole, total - 1);
}

/** A step through the list. `-1` walks toward older answers, `+1` toward newer.
 *  Deliberately does NOT wrap: the ends of a conversation are real, and an
 *  arrow that teleports from the first answer to the last would lose the
 *  operator's place with no way to tell it happened. */
export function stepVoiceIndex(total: number, index: number, step: -1 | 1): number {
  return clampVoiceIndex(total, clampVoiceIndex(total, index) + step);
}

/**
 * Where the reader should sit after the list changed.
 *
 * PINNED-TO-LATEST is the default because the surface is a live conversation:
 * she answers, and the answer is what you came to see. But an operator who has
 * ARROWED BACK is reading something specific, and yanking them forward because a
 * reply landed is the defect this function exists to prevent — so once they have
 * left the end, the entry they are on keeps its place by ID, not by index (a
 * server reconcile can renumber every optimistic row underneath them).
 */
export function nextVoicePosition(
  entries: readonly VoiceEntry[],
  previous: { id: string | null; pinned: boolean }
): number {
  const total = entries.length;
  if (total === 0) return -1;
  if (previous.pinned || !previous.id) return latestVoiceIndex(total);
  const held = entries.findIndex((entry) => entry.id === previous.id);
  // The held answer is gone (a new conversation, a reconcile that dropped an
  // optimistic row): fall back to the newest rather than to a stale number.
  return held === -1 ? latestVoiceIndex(total) : held;
}
