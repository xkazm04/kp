import type { InterviewTurn } from "./db";

// ---------------------------------------------------------------------------
// Transcript truncation policy for interview scoring
// ---------------------------------------------------------------------------
//
// The scorecard gates Interview→Offer (see runInterviewScorecard), so what the
// scoring model actually *sees* of a transcript is a trust-critical decision —
// not an incidental `.slice(...)`. Two limits bound that input; both used to be
// bare magic numbers (4000 / 6000) applied as silent front-slices, which meant
// the conclusion of the longest, richest interviews could be dropped before the
// scorer ever saw it, with no marker and no log. This module makes the policy
// explicit, named, documented, and visible when it bites.
//
// POLICY
//   1. Per-turn cap (MAX_TURN_TEXT_CHARS): a single turn is clamped at the
//      persistence boundary. This is a sanity guard against a pathological /
//      malformed turn (a single multi-thousand-char blob), not a normal-path
//      limit — ~4000 chars is far longer than any genuine spoken turn. When a
//      clamp actually discards characters the caller is told so it can log it.
//
//   2. Scorecard notes budget (MAX_SCORECARD_NOTES_CHARS): the joined notes fed
//      to the scorer are bounded. When the transcript fits, it is passed whole.
//      When it does not, we do NOT front-slice (which silently drops the
//      conclusion). Instead we keep the OPENING and the CLOSING of the
//      conversation — where the interviewer sets context and where conclusions,
//      wrap-up and the candidate's strongest closing signal live — and drop the
//      middle, replacing it with an explicit in-band marker. The scorer thus
//      always sees that it is reading a sampled transcript, the conclusion is
//      preserved, and runInterviewScorecard emits a structured warning recording
//      exactly how many turns / characters were dropped.
//
// Head+tail sampling was chosen over "raise the cap" (only moves the cliff) and
// over "summarize-then-score" (adds a second, lossy LLM hop on the gate path).
// If a future change makes summarization worthwhile, this is the single place to
// make it: every consumer goes through buildScorecardNotes.
// ---------------------------------------------------------------------------

/** Max characters kept for a single interview turn (sanity clamp on malformed
 *  input). Applied when the transcript is persisted in /api/interview/complete. */
export const MAX_TURN_TEXT_CHARS = 4000;

/** Character budget for the notes string handed to the scorecard task. The
 *  joined transcript is kept whole below this; above it, head+tail sampled. */
export const MAX_SCORECARD_NOTES_CHARS = 6000;

/** Characters reserved within the notes budget for the in-band truncation
 *  marker, so the kept head + tail + marker stays within MAX_SCORECARD_NOTES_CHARS. */
const MARKER_RESERVE_CHARS = 200;

function speaker(role: InterviewTurn["role"]): string {
  return role === "candidate" ? "Candidate" : role === "interviewer" ? "Interviewer" : "System";
}

function turnLine(t: InterviewTurn): string {
  return `${speaker(t.role)}: ${t.text}`;
}

/** Normalize an inbound turn to the canonical role set and clamp its text to
 *  MAX_TURN_TEXT_CHARS. Reports how many characters the clamp discarded (0 when
 *  the turn was within the cap) so the caller can surface real truncation. */
export function clampTurn(raw: { role?: unknown; text: unknown; at?: string }): {
  turn: InterviewTurn;
  clippedChars: number;
} {
  const role: InterviewTurn["role"] =
    raw.role === "candidate" || raw.role === "interviewer" ? raw.role : "system";
  const full = String(raw.text);
  const text = full.slice(0, MAX_TURN_TEXT_CHARS);
  return { turn: { role, text, at: raw.at }, clippedChars: full.length - text.length };
}

/** Flatten a transcript to the plain "Speaker: text" notes the scorer reads. */
export function transcriptToNotes(transcript: InterviewTurn[]): string {
  return transcript.map(turnLine).join("\n");
}

export type ScorecardNotes = {
  /** The notes string to hand to the scorecard task (already trimmed). */
  notes: string;
  /** True when head+tail sampling actually discarded one or more turns. */
  truncated: boolean;
  /** Whole turns dropped from the middle (0 when not truncated). */
  droppedTurns: number;
  /** Characters dropped from the joined transcript (0 when not truncated). */
  droppedChars: number;
  /** Turns kept in the sampled notes. */
  keptTurns: number;
  /** Turns in the original transcript. */
  totalTurns: number;
};

function omittedMarker(droppedTurns: number, droppedChars: number): string {
  const turns = droppedTurns === 1 ? "turn" : "turns";
  return `[… ${droppedTurns} ${turns} / ${droppedChars} characters omitted from the middle of the transcript to fit the scoring budget; the opening and closing are kept verbatim …]`;
}

/**
 * Build the notes string for the scorecard task under MAX_SCORECARD_NOTES_CHARS.
 *
 * Below budget the transcript is returned whole. Above budget it is head+tail
 * sampled at turn boundaries — opening and closing kept, middle replaced by an
 * explicit marker — and the returned metadata records exactly what was dropped
 * so the caller can log/flag it. See the policy note at the top of this file.
 */
export function buildScorecardNotes(transcript: InterviewTurn[]): ScorecardNotes {
  const totalTurns = transcript.length;
  const lines = transcript.map(turnLine);
  const full = lines.join("\n");

  if (full.length <= MAX_SCORECARD_NOTES_CHARS) {
    return {
      notes: full.trim(),
      truncated: false,
      droppedTurns: 0,
      droppedChars: 0,
      keptTurns: totalTurns,
      totalTurns,
    };
  }

  const budget = MAX_SCORECARD_NOTES_CHARS - MARKER_RESERVE_CHARS;

  // Degenerate case: a single turn alone exceeds the whole budget. There are no
  // turn boundaries to sample on, so hard-clip from the front and mark the tail.
  if (lines.length <= 1) {
    const kept = (lines[0] ?? "").slice(0, budget);
    const droppedChars = full.length - kept.length;
    const notes = `${kept}\n${omittedMarker(0, droppedChars)}`.trim();
    return { notes, truncated: true, droppedTurns: 0, droppedChars, keptTurns: 1, totalTurns };
  }

  const headBudget = Math.ceil(budget / 2);
  const tailBudget = budget - headBudget;

  // Greedily take whole turns from the front (always at least the first turn).
  let headEnd = 0;
  let headLen = 0;
  for (let i = 0; i < lines.length; i++) {
    const add = (headEnd > 0 ? 1 : 0) + lines[i].length; // +1 for the "\n" join
    if (headEnd > 0 && headLen + add > headBudget) break;
    headLen += add;
    headEnd = i + 1;
  }

  // Greedily take whole turns from the back, never crossing into the head slice
  // (always at least the last turn).
  let tailStart = lines.length;
  let tailLen = 0;
  for (let i = lines.length - 1; i >= headEnd; i--) {
    const add = (tailStart < lines.length ? 1 : 0) + lines[i].length;
    if (tailStart < lines.length && tailLen + add > tailBudget) break;
    tailLen += add;
    tailStart = i;
  }

  const droppedTurns = Math.max(0, tailStart - headEnd);
  const head = lines.slice(0, headEnd).join("\n");
  const tail = lines.slice(tailStart).join("\n");
  const keptTurns = headEnd + (lines.length - tailStart);

  // No middle turns actually fell out (head+tail met). Nothing was discarded at
  // the turn level — return the rejoined kept turns without a misleading marker.
  if (droppedTurns === 0) {
    const notes = `${head}\n${tail}`.trim();
    return { notes, truncated: false, droppedTurns: 0, droppedChars: 0, keptTurns, totalTurns };
  }

  const droppedChars = full.length - (head.length + tail.length);
  const notes = `${head}\n\n${omittedMarker(droppedTurns, droppedChars)}\n\n${tail}`.trim();
  return { notes, truncated: true, droppedTurns, droppedChars, keptTurns, totalTurns };
}
