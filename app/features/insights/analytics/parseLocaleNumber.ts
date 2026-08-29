// Parsing a number the way the reader WROTE it.
//
// The inline editors on this tab (channel spend, funnel targets) sit beside a
// figure rendered by `formatGrouped`, i.e. grouped in the reader's own locale. So
// an operator types back what they can see — and what they see differs per locale:
//
//   locale | group sep      | decimal sep | "twelve thousand"
//   en     | ,              | .           | 12,000
//   de     | .              | ,           | 12.000
//   cs     | U+00A0 (nbsp)  | ,           | 12 000
//   fr     | U+202F (nnbsp) | ,           | 12 000
//
// The editor used to strip whitespace and hand the rest to `Number()`, which is
// en-US-only. That is safe in `en` and `cs`/`fr` — `Number("12,000")` is NaN, a
// VISIBLE refusal — but in `de` it is not: `Number("12.000")` is 12. A German
// operator correcting a channel's spend to 12.000 Kč silently stored 12, and the
// cost-per-applicant column derived from it answered accordingly. A silent wrong
// write on a money path is strictly worse than a refusal, and it was the one
// outcome the old comment here set out to avoid.
//
// Resolving it needs the locale, not a guess: `1.234` is 1.234 in `en` and 1234 in
// `de`, and no amount of heuristics settles that without knowing who is typing.
//
// Pure and import-free ON PURPOSE. The feature doc listed this gap as blocked on
// "a parsing change on a money write path with no component-test layer to pin it";
// extracting the parse is what dissolves that blocker — `npm run test:unit` can
// exercise every locale × separator combination directly, which a component test
// never would have covered as well.

/** The group and decimal separators a locale actually formats numbers with, read
 *  from Intl rather than hardcoded, so a new locale needs no edit here. */
function separatorsFor(locale: string): { group: string; decimal: string } {
  const parts = new Intl.NumberFormat(locale).formatToParts(12345.6);
  const group = parts.find((p) => p.type === "group")?.value ?? ",";
  const decimal = parts.find((p) => p.type === "decimal")?.value ?? ".";
  return { group, decimal };
}

/**
 * Parse a number typed in `locale`'s own notation.
 *
 * Returns `null` for blank (the editors' "no value"), and `NaN` for anything that
 * is not a number in that locale — the caller refuses on `!Number.isFinite`, so an
 * ambiguous input still fails VISIBLY rather than storing a wrong figure.
 *
 * Every kind of space is dropped first: `formatGrouped` groups with U+00A0 in `cs`
 * and U+202F in `fr`, and a space is a group separator in all four shipped catalogs
 * and a decimal separator in none, so removing it cannot change a value's meaning.
 */
export function parseLocaleNumber(raw: string, locale: string): number | null {
  const stripped = raw.replace(/\s+/gu, "");
  if (stripped === "") return null;
  const { group, decimal } = separatorsFor(locale);
  // Group separators are removed; the locale's decimal separator becomes ".".
  // Order matters: `de` groups with "." and would otherwise eat its own decimals.
  const normalized = stripped.split(group).join("").split(decimal).join(".");
  // Reject anything left that Number() would coerce generously — "1.2.3" (two
  // decimals), "12px", "1e5" typed by hand. A strict shape keeps the refusal
  // visible instead of storing a coercion nobody asked for.
  if (!/^[+-]?\d*\.?\d*$/.test(normalized) || !/\d/.test(normalized)) return Number.NaN;
  return Number(normalized);
}
