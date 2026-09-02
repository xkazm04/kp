// The Assignments studio's user-visible copy, as seen from the SOURCE side.
//
// A guard helper with no runtime consumers on purpose: two different tests need the
// same view of "what text does this file put in front of a reader", and they must
// agree. devcase-studio-i18n.test.ts asserts there is NONE left in the migrated
// files; devcase-vocabulary.test.ts asserts that whatever is there never calls the
// assignment a "case". A copy of this extractor in each file would let those two
// answers drift, which is precisely how the header ended up saying "All cases" while
// every catalog-backed label already said Assignment.

/** The files the localization pass migrated. Adding a file here is how the ratchet
 *  grows. The studio files NOT listed (the define/outbox views, the eval panel, the
 *  lifecycle rows) are still English and are a stated gap in
 *  docs/features/dev-case/README.md — a known gap, not an oversight. */
export const STUDIO_LOCALIZED_FILES = [
  "DevAnalysisView.tsx",
  "DevAnalysisDesignCard.tsx",
  "DevAnalysisReflectionCard.tsx",
  "DevCaseDetail.tsx",
  "DevCaseDetailHeader.tsx",
  "DevCaseDetailInternal.tsx",
  "DevCaseDetailShortlist.tsx",
  "DevCaseDetailChannels.tsx",
  "DevCompareSubmissions.tsx",
  "DevApplyTokenPill.tsx",
  "DevPublishConfirm.tsx",
  "DevCasesEmpty.tsx",
  "DevCasesTable.tsx",
  "DevTab.tsx",
] as const;

/** Comments are allowed to hold English prose — including the retired words a
 *  rationale has to name — so they come out before anything is matched. A guard that
 *  fires on its own rationale teaches the next reader to delete the rationale. */
function withoutComments(src: string): string {
  return src
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^[ \t]*\/\/.*$/gm, " ");
}

/** JSX text nodes plus literal display attributes, as one list of strings.
 *
 *  A regex, not a parser: this is a RATCHET, not a proof. It sees the class that
 *  actually regressed here (a bare text node, a hardcoded title/aria-label) and it
 *  will not see English arriving through a helper or a template expression — the
 *  catalog-side tests cover the copy that IS wired up. Two consecutive letters are
 *  required so punctuation-only separators (`·`, `—`, `@`) are not mistaken for copy,
 *  and any segment carrying `{}()=;` or a backtick is skipped, which is what keeps
 *  expression containers and ordinary comparisons (`i > 0 && n < 5`) out. */
export function visibleLiterals(src: string): string[] {
  const clean = withoutComments(src);
  const out: string[] = [];
  for (const m of clean.matchAll(/>([^<>{}()=;`]*[A-Za-z]{2,}[^<>{}()=;`]*)</g)) {
    if (m[1].trim()) out.push(m[1].trim());
  }
  for (const m of clean.matchAll(/\b(?:title|aria-label|placeholder|label|alt)\s*=\s*"([^"]*[A-Za-z]{2,}[^"]*)"/g)) {
    out.push(m[1]);
  }
  return out;
}
