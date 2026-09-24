// Anchor a quote to the transcript turn it came from — ONE pure matcher for every
// surface that has to ask "did the candidate actually say this?".
//
// Two callers, two strictness levels, one logic:
//   - the recruiter's transcript modal anchors a scorecard evidence quote to a turn
//     (app/features/hiring/schedule/scheduleInterviewTranscriptHelpers.ts
//     findEvidenceTurn — the logic this module generalizes; that helper keeps its own
//     copy for now and is the reference for the lenient defaults below);
//   - the interview director verifies the model's `mark_topic_covered` evidence quote
//     against the candidate's PERSISTED words before it records a topic as covered
//     (app/_lib/voice/director.ts), with the strict options: the quote must sit inside
//     what the candidate said, never the other way round.
//
// The registry's evidence-quote-requirement is the reason the strict side exists: a
// model's paraphrase is fluent, plausible and indistinguishable in tone from a
// transcript excerpt — the most convincing wrong evidence available — so provenance
// is checked, not assumed. The check is FUZZY on purpose: the realtime model hears
// the audio and quotes its own rendering of it, while the persisted text is the
// provider's transcription, so casing, punctuation and diacritics routinely differ.

export type QuoteMatchOptions = {
  /** A normalized quote shorter than this never matches (default 8). */
  minChars?: number;
  /** Words shorter than this are not "distinctive" for the overlap fallback (default 4). */
  minWordLength?: number;
  /** Share of the quote's distinct distinctive words a turn must contain (default 0.5). */
  minWordOverlap?: number;
  /** …and never fewer than this many shared words (default 1). */
  minSharedWords?: number;
  /** Also accept a turn that sits INSIDE the quote (default true — the modal's reading).
   *  The director turns it off: a model summary that embeds a short "yes, I did" turn
   *  is not the candidate's evidence. */
  allowTurnInsideQuote?: boolean;
  /** Also try each turn joined with the next one, for a sentence the recognizer split
   *  across two turns (default true). */
  spanAdjacentTurns?: boolean;
};

const DEFAULTS: Required<QuoteMatchOptions> = {
  minChars: 8,
  minWordLength: 4,
  minWordOverlap: 0.5,
  minSharedWords: 1,
  allowTurnInsideQuote: true,
  spanAdjacentTurns: true,
};

/** Case-, punctuation-, diacritic- and whitespace-insensitive form of a text. */
export function normalizeQuoteText(s: string): string {
  return String(s ?? "")
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function distinctWords(normalized: string, minLength: number): Set<string> {
  return new Set(normalized.split(" ").filter((w) => w.length >= minLength));
}

/**
 * The index of the turn `quote` came from, or -1 when nothing matches well enough.
 * Containment first (the quote inside a turn, or inside a turn joined with its
 * neighbour); otherwise the turn sharing the largest share of the quote's DISTINCT
 * distinctive words, gated by `minWordOverlap` and `minSharedWords` so a paraphrase
 * built from generic words is not mis-anchored to an unrelated turn.
 */
export function matchQuoteToTurn(quote: string, turnTexts: readonly string[], options: QuoteMatchOptions = {}): number {
  const o = { ...DEFAULTS, ...options };
  const e = normalizeQuoteText(quote);
  if (e.length < o.minChars) return -1;
  const turns = turnTexts.map((t) => normalizeQuoteText(t));

  for (let i = 0; i < turns.length; i++) {
    const t = turns[i];
    if (t.length === 0) continue;
    if (t.includes(e)) return i;
    if (o.allowTurnInsideQuote && t.length >= o.minChars && e.includes(t)) return i;
  }
  // A second pass, so a quote wholly inside one turn is never credited to the pair
  // that merely contains that turn.
  if (o.spanAdjacentTurns) {
    for (let i = 0; i + 1 < turns.length; i++) {
      if (turns[i].length > 0 && turns[i + 1].length > 0 && `${turns[i]} ${turns[i + 1]}`.includes(e)) return i;
    }
  }

  const eWords = distinctWords(e, o.minWordLength);
  if (eWords.size === 0) return -1;
  let best = -1;
  let bestShared = 0;
  let bestScore = 0;
  for (let i = 0; i < turns.length; i++) {
    // DISTINCT words on both sides (the lesson findEvidenceTurn already paid for): a
    // turn repeating one word must not stand in for several.
    let shared = 0;
    for (const w of distinctWords(turns[i], o.minWordLength)) if (eWords.has(w)) shared += 1;
    const score = shared / eWords.size;
    if (score > bestScore) {
      bestScore = score;
      bestShared = shared;
      best = i;
    }
  }
  return bestScore >= o.minWordOverlap && bestShared >= o.minSharedWords ? best : -1;
}
