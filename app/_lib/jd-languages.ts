// Language IDENTITY for the JD builder: every form of a language's name maps to one
// canonical id, so "Znalost češtiny" (the author) and "Čeština" (the model) are the
// same language even though they share no token. Pure, no imports.
//
// Normalisation matches roleTraceTokens: NFD, no diacritics, lowercase, tokens of
// [a-z0-9]. What counts as a MENTION of a language:
//   - its name in English, Czech, German or French, its own name (Deutsch, polski), and
//     the Czech noun in every case (čeština, češtiny, češtinu, češtině, češtinou);
//   - the Czech adverb (česky, anglicky) — alone;
//   - a Czech adjective (český, anglického, německá …) ONLY beside "jazyk" in any case
//     ("anglický jazyk", "znalost německého jazyka"). Alone it is ambiguous ("český trh").
//     The masculine nominative adjective and the adverb normalise to the SAME token
//     (cesky), so a bare "cesky" is read as the adverb and counts.
//
// NEGATION. A mention is negated when its clause (split at . ; , : ! ? ( ) newline and
// the words but / ale / však) holds a cue: en no, not, without, neither, nor; cs bez,
// není, nevyžadujeme, nepotřebujeme, nemusí. "Not required / not needed / není nutná /
// není potřeba" are covered by their first word. A language is STATED when at least one
// of its mentions sits in a clause with no cue. Known miss: "not only English but also
// German" negates English.

export type LanguageId =
  | "cs" | "sk" | "en" | "de" | "pl" | "fr" | "es" | "it" | "ru" | "uk" | "hu";

const strip = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function languageTokens(text: string): string[] {
  return strip(text ?? "").match(/[a-z0-9]+/g) ?? [];
}

type Entry = {
  id: LanguageId;
  /** Every plain name form (en / cs / de / fr / own / Czech adverb). */
  names: string[];
  /** Czech noun stems: stem + ina|iny|inu|ine|inou. */
  nounStems: string[];
  /** Czech adjective stem: stem + y|a|e|eho|emu|em|ym|i|ych|ymi|ou — only beside "jazyk". */
  adjStem: string;
};

const ENTRIES: Entry[] = [
  { id: "cs", names: ["czech", "cesky", "tschechisch", "tcheque", "cestina"], nounStems: ["cest"], adjStem: "cesk" },
  { id: "sk", names: ["slovak", "slovensky", "slowakisch", "slovaque", "slovencina", "slovenstina"], nounStems: ["slovenst", "slovenc"], adjStem: "slovensk" },
  { id: "en", names: ["english", "anglicky", "englisch", "anglais", "anglaise"], nounStems: ["anglict"], adjStem: "anglick" },
  { id: "de", names: ["german", "nemecky", "deutsch", "allemand", "allemande"], nounStems: ["nemc"], adjStem: "nemeck" },
  { id: "pl", names: ["polish", "polsky", "polnisch", "polonais", "polonaise", "polski"], nounStems: ["polst"], adjStem: "polsk" },
  { id: "fr", names: ["french", "francouzsky", "franzosisch", "francais", "francaise"], nounStems: ["francouzst"], adjStem: "francouzsk" },
  { id: "es", names: ["spanish", "spanelsky", "spanisch", "espagnol", "espagnole", "espanol"], nounStems: ["spanelst"], adjStem: "spanelsk" },
  { id: "it", names: ["italian", "italsky", "italienisch", "italien", "italienne", "italiano"], nounStems: ["italst"], adjStem: "italsk" },
  { id: "ru", names: ["russian", "rusky", "russisch", "russe", "russkij"], nounStems: ["rust"], adjStem: "rusk" },
  { id: "uk", names: ["ukrainian", "ukrajinsky", "ukrainisch", "ukrainien", "ukrainienne"], nounStems: ["ukrajinst"], adjStem: "ukrajinsk" },
  { id: "hu", names: ["hungarian", "madarsky", "ungarisch", "hongrois", "hongroise", "magyar"], nounStems: ["madarst"], adjStem: "madarsk" },
];

const NOUN_SUFFIXES = ["ina", "iny", "inu", "ine", "inou"];
const ADJ_SUFFIXES = ["y", "a", "e", "eho", "emu", "em", "ym", "i", "ych", "ymi", "ou"];
// German "-isch" adjectives take endings (englische, deutschen …).
const DE_ENDINGS = ["e", "en", "er", "es", "em"];

const PLAIN = new Map<string, LanguageId>();
const ADJ = new Map<string, LanguageId>();
for (const e of ENTRIES) {
  for (const n of e.names) if (!n.includes(" ")) PLAIN.set(n, e.id);
  for (const s of e.nounStems) for (const x of NOUN_SUFFIXES) PLAIN.set(s + x, e.id);
  for (const x of ADJ_SUFFIXES) ADJ.set(e.adjStem + x, e.id);
  for (const n of e.names) {
    if (n.endsWith("isch")) for (const x of DE_ENDINGS) PLAIN.set(n + x, e.id);
  }
}

function isJazyk(tok: string | undefined): boolean {
  // jazyk, jazyka, jazyku, jazykem, jazyce, jazyky, jazyku, jazyku
  return !!tok && /^jazy(k|c)/.test(tok);
}

/** Canonical ids of every language MENTIONED in one clause's tokens. */
function mentionsIn(tokens: string[]): LanguageId[] {
  const out: LanguageId[] = [];
  tokens.forEach((t, i) => {
    const plain = PLAIN.get(t);
    if (plain) return void out.push(plain);
    const adj = ADJ.get(t);
    if (adj && (isJazyk(tokens[i - 1]) || isJazyk(tokens[i + 1]))) out.push(adj);
  });
  return out;
}

const NEGATION_CUES = new Set([
  "no", "not", "without", "neither", "nor",
  "bez", "neni", "nevyzadujeme", "nepotrebujeme", "nemusi",
]);

/** Clause split. A clause is the negation scope. */
function clauses(text: string): string[][] {
  return strip(text ?? "")
    .split(/[.;,:!?()\n\r]+|\b(?:but|ale|vsak)\b/)
    .map((c) => c.match(/[a-z0-9]+/g) ?? [])
    .filter((c) => c.length);
}

/** The canonical ids a free-text language name resolves to (empty = not in the lexicon). */
export function languageIds(name: string): LanguageId[] {
  const toks = languageTokens(name);
  return [...new Set(mentionsIn(toks))];
}

export type LanguageMentions = { stated: Set<LanguageId>; negated: Set<LanguageId> };

/** Which languages the author's text states, and which it names only to rule them out. */
export function languageMentions(authorText: string): LanguageMentions {
  const stated = new Set<LanguageId>();
  const seen = new Set<LanguageId>();
  for (const c of clauses(authorText)) {
    const ids = mentionsIn(c);
    if (!ids.length) continue;
    const negated = c.some((t) => NEGATION_CUES.has(t));
    for (const id of ids) {
      seen.add(id);
      if (!negated) stated.add(id);
    }
  }
  return { stated, negated: new Set([...seen].filter((id) => !stated.has(id))) };
}
