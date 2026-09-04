// The Background-tasks free-text filter, as one pure function.
//
// It was the same expression typed out twice — once in TasksTab.tsx over the live
// window, once in TasksHistory.tsx over the paged trail — which is how the two halves
// of one search box drift: the tab and the trail below it are a single question the
// user asked, and they must answer it identically or a run "disappears" at the window
// boundary. One function, one test.
//
// The needle is normalised the way a person types rather than the way a string is
// stored: case-folded AND diacritic-folded. Task labels are rendered in the reader's
// language (three of the four catalogs carry diacritics), so "prubeh" must find
// "Průběh" and "uber" must find "Übernahme" — searching your own language should not
// require reaching for the accented keys, and the raw `.toLowerCase().includes()` this
// replaces made cs/de/fr search noticeably worse than English.

/** Case- and diacritic-folded, whitespace-trimmed. NFD splits an accented letter into
 *  its base plus a combining mark, which the `\p{Diacritic}` class then strips. */
function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

/** The needle, prepared once per keystroke rather than once per row. An empty needle
 *  is the "no filter" state and every row matches it. */
export function taskSearchNeedle(text: string): string {
  return fold(text);
}

/**
 * Does this run match what the user typed?
 *
 * @param renderedLabel the label AS SHOWN — resolved through `renderTaskLabel`, so the
 *   search is over the words on screen in the reader's language. Filtering the encoded
 *   `kp.tl:{…}` column instead would have made the box work in English only.
 * @param kind the raw kind identifier (`batch_screen`). Kept as a SECOND haystack, not
 *   a replacement: an operator who knows the internal name can still search by it, and
 *   it is what an untranslated row falls back to.
 * @param needle output of `taskSearchNeedle` — already folded.
 */
export function taskMatchesSearch(renderedLabel: string, kind: string, needle: string): boolean {
  if (!needle) return true;
  return fold(renderedLabel).includes(needle) || fold(kind).includes(needle);
}
