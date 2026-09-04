import type { VoiceTurn } from "./voice/types";

// --- The stored transcript is BOUNDED ---------------------------------------
//
// Every turn was appended unconditionally: the row grew without limit, the whole
// thing was JSON-stringified into the workdir on every spawn (twice per exchange),
// and the session read returned it whole down the wire — for turns the engine
// itself stopped reading long ago. `pipeline/jobfit/intake.py` renders only its
// newest MAX_TRANSCRIPT_TURNS = 48 turns into any prompt, so a turn older than
// that has had ZERO influence on the conversation for as long as it has been
// stored. The cap is set to exactly that window, which is also what keeps the
// brief's `sourceTurn` citations honest: they index the stored transcript, and a
// cap other than the engine's window would silently renumber them.
export const MAX_STORED_TURNS = 48;

/** The machine marker for the one compaction turn. It is a WIRE token, not copy:
 *  the panel resolves it into the reader's language (`library.tab.intake.compacted`)
 *  rather than storing an English sentence in the row. */
export const COMPACTED_TURN_PREFIX = "kp:transcript-compacted:";

/** How many turns a compaction marker turn accounts for, or 0 when the turn is
 *  not one. Shared with the renderer so the token has one parser. */
export function compactedTurnCount(turn: VoiceTurn | undefined): number {
  if (!turn || turn.role !== "system" || !turn.text.startsWith(COMPACTED_TURN_PREFIX)) return 0;
  const n = Number.parseInt(turn.text.slice(COMPACTED_TURN_PREFIX.length), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Keep the newest `max` turns and, when anything was dropped, ONE leading system
 *  turn carrying the running count of dropped turns — the transcript says how much
 *  of itself is gone instead of quietly starting mid-sentence. Idempotent: a prior
 *  marker is absorbed into the new count rather than stacking. */
export function capTranscript(turns: VoiceTurn[], max: number = MAX_STORED_TURNS): VoiceTurn[] {
  const alreadyDropped = compactedTurnCount(turns[0]);
  const body = alreadyDropped > 0 ? turns.slice(1) : turns;
  if (body.length <= max) return turns;
  const kept = body.slice(body.length - max);
  const dropped = alreadyDropped + (body.length - max);
  return [
    { role: "system" as const, text: `${COMPACTED_TURN_PREFIX}${dropped}`, at: kept[0]?.at },
    ...kept,
  ];
}
