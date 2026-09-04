// Single source for avatar / logo monograms across the app: candidate avatars
// (PipelineShared, CandidateDrawer, DecisionsShared, GroupEvalModal), the
// schedule grid (ScheduleCalendar), and the offer page's company logo slot.
// Six near-identical copies had quietly drifted — some split on a single " ",
// others on /\s+/; the fallback was "?" in one place, "•" in another, and
// nothing in the rest. This reconciles them into one explicit behavior: trim,
// split on any run of whitespace, take the first letter of the first two words,
// uppercase; when there is nothing to show, return the caller's `fallback`
// (default empty string).

// "First letter" is a GRAPHEME, not `word[0]`. A JS string is indexed by UTF-16
// code units, so `word[0]` returns HALF of any character outside the basic plane —
// a lone surrogate, which renders as the replacement glyph (an avatar showing "�"
// for a name the app otherwise handles fine). The same indexing also strips a
// combining mark, turning "Ångström" written as A + U+030A into a bare "A".
// Neither is exotic in a 4-locale product that takes names from CVs and apply
// forms in any script.
//
// Intl.Segmenter is the only correct answer: it is the platform's own grapheme
// cluster boundary algorithm (UAX #29), so an emoji with a ZWJ sequence or a skin
// tone modifier, a Devanagari consonant + vowel sign, and a base letter + combining
// accent each count as ONE character — which is what a reader means by a first
// letter. Node 18+ and every browser this app supports ship it; the spread fallback
// below is for any runtime that does not, and is still strictly better than `[0]`
// because `[...word]` iterates CODE POINTS, keeping a surrogate pair whole. It
// cannot join a combining mark to its base — accepting that is the point of having
// a named fallback rather than pretending the two paths are equivalent.
//
// Constructed once at module scope: a Segmenter carries ICU setup cost that is real
// on a roster rendering a monogram per row.
const GRAPHEMES =
  typeof Intl !== "undefined" && typeof Intl.Segmenter === "function"
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : null;

/** The first grapheme cluster of `word` — the whole first character a reader sees,
 *  surrogate pairs and combining marks included. `""` for an empty string. Exported
 *  because the public pipeline feed's `initialsLabel` (app/_lib/pipeline-events-public.ts)
 *  needs exactly this and nothing else: its OUTPUT contract is different (dotted
 *  "M. K.", `null` rather than a fallback, because it is a privacy projection and an
 *  empty label there must be indistinguishable from an absent one) but the way a
 *  first letter is taken must not be. */
export function firstGrapheme(word: string): string {
  if (!word) return "";
  if (GRAPHEMES) {
    for (const { segment } of GRAPHEMES.segment(word)) return segment;
    return "";
  }
  return [...word][0] ?? "";
}

export function initials(label: string | null | undefined, fallback = ""): string {
  return (
    (label ?? "")
      .trim()
      .split(/\s+/)
      // The first two WORDS, taken before the letters are — slicing the joined
      // string to 2 would be a UTF-16 slice again, and would cut an astral first
      // letter in half after all the care above.
      .slice(0, 2)
      .map(firstGrapheme)
      .filter(Boolean)
      .join("")
      .toUpperCase() || fallback
  );
}
