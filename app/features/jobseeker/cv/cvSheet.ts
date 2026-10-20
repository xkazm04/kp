// The designed CV's words and marks that are the SHEET's, not the document's: the
// separator of an entry's first line, a skill's level word, the bold of an emphasis term,
// the running head's string. Pure, so the sheet (DesignedCv.tsx), its plain-text reading
// (cvRoundTrip.ts) and `node --test` share one spelling of each.

/** Between a role and its employer on the entry's one line - the keyless draft's own
 *  "Role — Org" form, which the builder's parseRoleTitle reads back. */
export const CV_ORG_SEPARATOR = " — ";

/** A CSS string literal for text the SEEKER wrote (their name in the running head): every
 *  character outside letters, digits and plain punctuation is a hex escape, so no quote,
 *  backslash or `</style` can leave the literal. */
export function cssString(text: string): string {
  const body = [...text].map((c) => (/[\p{L}\p{N} .,'&-]/u.test(c) ? c : `\\${c.codePointAt(0)!.toString(16)} `)).join("");
  return `"${body}"`;
}

/** A bullet's emphasis as sorted, non-overlapping [start, end) ranges of its text: each
 *  term the document names, bold at its first whole-word occurrence (any case). Nothing
 *  else in a bullet is ever bold (registry scan-path-hierarchy: bold is for the entry
 *  head, and at most a phrase inside a bullet). */
export function emphasisRanges(text: string, emphasis: readonly string[] | undefined): [number, number][] {
  const found: [number, number][] = [];
  const lower = text.toLocaleLowerCase();
  for (const e of emphasis ?? []) {
    const term = e.trim().toLocaleLowerCase();
    if (!term) continue;
    for (let at = lower.indexOf(term); at >= 0; at = lower.indexOf(term, at + 1)) {
      const before = at === 0 ? "" : lower[at - 1]!;
      const after = lower[at + term.length] ?? "";
      if (!/[\p{L}\p{N}]/u.test(before) && !/[\p{L}\p{N}]/u.test(after)) {
        found.push([at, at + term.length]);
        break;
      }
    }
  }
  found.sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const r of found) if (!out.length || r[0] >= out[out.length - 1]![1]) out.push(r);
  return out;
}

/** A skill as the sheet sets it: the name, and the CV's own level WORD after it when the
 *  CV states one ("Kubernetes (expert)") - a word, never a drawn meter. */
export function skillText(it: { name: string; level: string | null }): string {
  return it.level ? `${it.name} (${it.level})` : it.name;
}

/** The same text in two parts, so a template can set the level word quieter than the
 *  name: `name + (level ?? "")` IS `skillText(it)`, character for character - the sheet
 *  styles the words, it never changes them. */
export function skillParts(it: { name: string; level: string | null }): { name: string; level: string | null } {
  return { name: it.name, level: it.level ? ` (${it.level})` : null };
}
