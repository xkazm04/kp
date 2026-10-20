// A seeker's stated target title, expanded to the titles that name the SAME job.
//
// One table, two readers: the matcher (pipeline/jobfit/target_titles.py) and the feed
// adapters' title filter (adapters/shared.ts `matchesTargets`) both read
// pipeline/jobfit/target_title_aliases.json, so what a fetch keeps and what the matcher
// calls "your target" cannot drift apart. Without it the MPSV filter read 39,644 Czech
// vacancies against the literal words "AI Engineer" and kept none (live scan, 2026-09-25).

import aliases from "@/pipeline/jobfit/target_title_aliases.json";

const GROUPS: readonly (readonly string[])[] = (aliases as { groups: string[][] }).groups;

function fold(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Folded whole-word form: " ai engineer " (padded, so `includes` is a whole-word test). */
export function titleWords(s: string): string {
  const words = fold(s).split(/[^\p{L}\p{N}+#]+/u).filter(Boolean);
  return words.length ? ` ${words.join(" ")} ` : "";
}

/** Every folded whole-word form that counts as one stated title: itself plus, when it is
 *  a member of an alias group, every member of that group. */
export function targetForms(title: string): string[] {
  const own = titleWords(title);
  if (!own) return [];
  const group = GROUPS.find((g) => g.some((alias) => titleWords(alias) === own));
  const forms = new Set([own]);
  for (const alias of group ?? []) {
    const f = titleWords(alias);
    if (f) forms.add(f);
  }
  return [...forms];
}
