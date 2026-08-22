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
  | { kind: "missing"; what: "salary" | "place" }
  // 7469c05f — inclusive-language: a phrase that narrows the applicant pool
  // (gendered/coded, ageist, masculine-coded), or an over-long must-have list.
  | { kind: "exclusionary"; phrase: string }
  | { kind: "manyMustHaves"; count: number };

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

// Inclusive-language patterns (7469c05f) — phrases shown to shrink or skew the
// applicant pool: gendered/coded terms, masculine-coded adjectives, and ageist
// language. (rockstar/ninja/guru already flag under `vague`, so they're not
// repeated here.) EN + CS, same giu folding + \p{L} inflection tolerance.
const EXCLUSIONARY_PATTERNS: RegExp[] = [
  // Gendered / coded
  /\b(?:he\/she|s\/he|\(s\)he|he\s+or\s+she)\b/giu,
  /\b(?:guys|manpower|man-?hours?|chairman|salesman|foreman|workmanlike)\b/giu,
  // Masculine-coded adjectives (research-backed: deter women applicants)
  /\b(?:aggressive|dominant|fearless|assertive|ruthless|hard-?charging)\b/giu,
  // Ageist
  /\b(?:young|youthful|digital\s+native|recent\s+grad(?:uate)?s?|fresh\s+graduate|fresh\s+out\s+of)\b/giu,
  // Czech: ageist / gendered
  /\bmlad\p{L}*\s+(?:člověk\p{L}*|uchazeč\p{L}*|nadšenec\p{L}*)/giu,
];

// "must"/"required"/"musí"/"nutné" markers — a long list of them deters
// under-represented applicants who self-select out unless they meet 100%.
//
// Unicode-aware word guards, NOT `\b`: JS `\b` is defined by ASCII `\w`, so a
// trailing `\b` after a diacritic-final stem can never match — in "musí mít"
// both "í" and " " are non-`\w`, there is no boundary, and /musí\b/ failed on
// EVERY occurrence. A Czech JD listing twelve "musí …" requirements therefore
// counted ZERO must-have markers and lint clean, while the same JD in English
// flagged. (Same hazard the PLACE_RE comment above calls out; the stems already
// use \p{L} for the identical reason.) `(?<!\p{L})…(?!\p{L})` keeps the English
// behavior byte-identical and makes the Czech markers count.
const MUST_HAVE_RE = /(?<!\p{L})(?:must(?:\s+have)?|required|musí\p{L}*|nutn\p{L}*|povinn\p{L}*)(?!\p{L})/giu;
const MANY_MUST_HAVES = 8;

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
function collectPhrases(text: string, patterns: RegExp[]): string[] {
  const hits: { index: number; phrase: string }[] = [];
  for (const pattern of patterns) {
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

export function findVaguePhrases(text: string): string[] {
  return collectPhrases(text, VAGUE_PATTERNS);
}

/** Non-inclusive phrases (gendered/coded, masculine-coded, ageist), in document
 *  order, first occurrence per phrase. (7469c05f) */
export function findExclusionaryPhrases(text: string): string[] {
  return collectPhrases(text, EXCLUSIONARY_PATTERNS);
}

/**
 * Lint a JD body for the two specificity classes that decide conversion:
 * boilerplate phrases to replace, and missing concretes (pay, place).
 *
 * `salaryAvailable` — the builder's structured market band exists, so the
 * published artifacts will carry a figure even if the prose doesn't spell one
 * out yet; suppresses the missing-salary finding.
 *
 * `mustHaveCount` — the STRUCTURED must-have count from the build artifacts, when
 * the caller has them. Without it this rule was unreachable on generated JDs:
 * composeMarkdown renders role.mustHaves as plain bullets under "What you'll bring"
 * (and the seeded template under {{heading_requirements}}), and neither emits a
 * marker word — so an eleven-dealbreaker RoleSpec produced a body whose prose count
 * was ZERO and linted clean. The threshold only ever fired on recruiter-TYPED prose,
 * i.e. the one case the AI did not produce. That matters because the Python coercion
 * deliberately does NOT clamp the list (a blind slice can drop a confirmed
 * dealbreaker listed ninth), which makes this lint the compensating control.
 */
export function lintJd(input: {
  body: string;
  salaryAvailable?: boolean;
  mustHaveCount?: number;
}): JdLintFinding[] {
  const body = input.body ?? "";
  const findings: JdLintFinding[] = findVaguePhrases(body).map((phrase) => ({ kind: "vague", phrase }));
  if (!input.salaryAvailable && !MONEY_RE.test(body)) findings.push({ kind: "missing", what: "salary" });
  if (!PLACE_RE.test(body)) findings.push({ kind: "missing", what: "place" });
  // 7469c05f — inclusivity: coded/exclusionary phrases + an over-long must-have list.
  for (const phrase of findExclusionaryPhrases(body)) findings.push({ kind: "exclusionary", phrase });
  // max(), not a replacement: a generated body can ALSO carry typed marker prose,
  // and whichever count is higher is the one worth warning about.
  const mustHaves = Math.max((body.match(MUST_HAVE_RE) ?? []).length, input.mustHaveCount ?? 0);
  if (mustHaves > MANY_MUST_HAVES) findings.push({ kind: "manyMustHaves", count: mustHaves });
  return findings;
}

// A `library.result.lint*` translation-key + ICU-values descriptor for one lint
// finding. Colocated with the JdLintFinding union and switched EXHAUSTIVELY so a
// future kind is a COMPILE error at the `assertNever` default — rather than the
// panel's nested ternary silently falling through to the "missing place" label
// for an unrelated finding. bug-ui-scan-2026-07-09 (jd-authoring-library-templates #5)
export type JdLintMessage =
  | { key: "lintVague"; values: { phrase: string } }
  | { key: "lintExclusionary"; values: { phrase: string } }
  | { key: "lintManyMustHaves"; values: { count: number } }
  | { key: "lintMissingSalary"; values?: undefined }
  | { key: "lintMissingPlace"; values?: undefined };

export function jdLintMessage(f: JdLintFinding): JdLintMessage {
  switch (f.kind) {
    case "vague":
      return { key: "lintVague", values: { phrase: f.phrase } };
    case "exclusionary":
      return { key: "lintExclusionary", values: { phrase: f.phrase } };
    case "manyMustHaves":
      return { key: "lintManyMustHaves", values: { count: f.count } };
    case "missing":
      return f.what === "salary" ? { key: "lintMissingSalary" } : { key: "lintMissingPlace" };
    default:
      return assertNever(f);
  }
}

// Compile-time exhaustiveness guard: reaching this with a real value means a
// JdLintFinding kind was added without a jdLintMessage branch (a type error here),
// and the runtime throw stops a silently-mislabeled finding from shipping.
function assertNever(x: never): never {
  throw new Error(`Unhandled JdLintFinding: ${JSON.stringify(x)}`);
}
