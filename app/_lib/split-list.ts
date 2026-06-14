// ONE delimiter-split for the candidate free-text list fields (languages,
// skills, aspirations) the intake surfaces parse. Splits on commas/semicolons,
// trims, and drops empties. `newlines: true` ALSO splits on line breaks (and
// collapses delimiter runs) — the ProfileEditor textareas need that; the
// single-line completeness follow-up answers deliberately do not. Pure,
// dependency-free helper so a future tweak (e.g. also split on "/") lands in one
// place instead of drifting across hand-copied closures.
export function splitList(text: string, opts?: { newlines?: boolean }): string[] {
  const pattern = opts?.newlines ? /[,\n;]+/ : /[,;]/;
  return text
    .split(pattern)
    .map((s) => s.trim())
    .filter(Boolean);
}
