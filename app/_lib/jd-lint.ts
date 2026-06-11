// JD specificity lint (Erika gap E7) — the "trust" principle from blue-collar
// sourcing applied to tech JDs: concrete facts (pay, place) convert; boilerplate
// ("competitive salary", "dynamic environment") reads as a red flag and kills
// conversion. Pure and registry-free so the rules are unit-testable and can run
// live on every keystroke in the builder; findings carry canonical kinds (the
// display copy lives in the catalogs).
//
// Deliberately rules-only (no LLM): the check must be instant, deterministic,
// and free — it runs on every edit. The phrase lists are the highest-frequency
// offenders in EN + CS job ads, with inflection-tolerant Czech stems (\p{L}
// because JS \w excludes diacritics — /konkurenceschopn\w*/ would stall at "ý").

export type JdLintFinding =
  | { kind: "vague"; phrase: string }
  | { kind: "missing"; what: "salary" | "place" };

// Vague-phrase patterns. Each match is reported with the text as written, so
// the recruiter sees exactly what to replace. `giu`: global (collect all),
// case-insensitive with Unicode folding (Kč/Č), \p{L} for inflected endings.
const VAGUE_PATTERNS: RegExp[] = [
  // English
  /competitive\s+(?:salary|compensation|pay)/giu,
  /attractive\s+(?:salary|compensation)/giu,
  /salary\s+commensurate\s+with/giu,
  /join\s+our\s+(?:team|family)/giu,
  /dynamic\s+(?:environment|team|workplace)/giu,
  /fast-?paced\s+environment/giu,
  /\b(?:rockstar|ninja|guru)\b/giu,
  /work\s+hard,?\s+play\s+hard/giu,
  // Czech (stems tolerate inflection: konkurenceschopný/-é/-ého …)
  /konkurenceschopn\p{L}*\s+(?:plat\p{L}*|mzd\p{L}*|ohodnocen\p{L}*)/giu,
  /atraktivn\p{L}*\s+(?:finanč\p{L}*\s+ohodnocen\p{L}*|plat\p{L}*|mzd\p{L}*|ohodnocen\p{L}*)/giu,
  /motivující\s+(?:finanční\s+)?ohodnocen\p{L}*/giu,
  /dynamick\p{L}*\s+(?:prostřed\p{L}*|tým\p{L}*|kolektiv\p{L}*)/giu,
  /mlad\p{L}*\s+kolektiv\p{L}*/giu,
  /rodinn\p{L}*\s+atmosf\p{L}*/giu,
  /staň\p{L}*\s+se\s+součástí/giu,
];

// A stated pay figure: digits followed by a currency token ("65 000 Kč",
// "65,000 CZK", "3 200 EUR"), or a currency symbol followed by digits ("€3,200",
// "$120k"). Includes NBSP/narrow-NBSP — common thousands separators in cs text.
const MONEY_RE = /\d[\d\s  .,]*\s*(?:kč|czk|eur(?:o)?\b|usd\b)|[€$]\s?\d/iu;

// A stated place of work: a work-mode keyword (EN or CS) or a major CZ city.
// Substring stems on purpose — "hybridní", "v kanceláři", "remotely" all count;
// trailing ASCII \b would break after diacritics (plzeň), so none is used.
const PLACE_RE =
  /remote|hybrid|on-?site|home\s*office|na\s+dálku|z\s+domova|kancelář|praha|prague|brno|ostrava|plzeň|plzen|olomouc|liberec|hradec/iu;

/** Every boilerplate phrase in `text`, as written, in DOCUMENT order (the
 *  recruiter reads the findings against their own text top-to-bottom), first
 *  occurrence per phrase (case-insensitively deduped so "Dynamic team" and
 *  "dynamic team" report once). */
export function findVaguePhrases(text: string): string[] {
  const hits: { index: number; phrase: string }[] = [];
  for (const pattern of VAGUE_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      hits.push({ index: match.index ?? 0, phrase: match[0].replace(/\s+/g, " ").trim() });
    }
  }
  hits.sort((a, b) => a.index - b.index);
  const seen = new Set<string>();
  const phrases: string[] = [];
  for (const hit of hits) {
    const key = hit.phrase.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      phrases.push(hit.phrase);
    }
  }
  return phrases;
}

/**
 * Lint a JD body for the two specificity classes that decide conversion:
 * boilerplate phrases to replace, and missing concretes (pay, place).
 *
 * `salaryAvailable` — the builder's structured market band exists, so the
 * published artifacts will carry a figure even if the prose doesn't spell one
 * out yet; suppresses the missing-salary finding.
 */
export function lintJd(input: { body: string; salaryAvailable?: boolean }): JdLintFinding[] {
  const body = input.body ?? "";
  const findings: JdLintFinding[] = findVaguePhrases(body).map((phrase) => ({ kind: "vague", phrase }));
  if (!input.salaryAvailable && !MONEY_RE.test(body)) findings.push({ kind: "missing", what: "salary" });
  if (!PLACE_RE.test(body)) findings.push({ kind: "missing", what: "place" });
  return findings;
}
