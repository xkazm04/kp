// The designed CV's CONTENT rules — pure, no React, so `node --test` holds it.
//
// cvDocument.ts reads a CV into a document; this module decides what the document may
// SAY, held to the registry standard recruiting/cv-content-construction (golden path
// + techniques, forged 2026-09-26). The writer's tools are selection, order, wording
// and grouping; addition belongs to the owner alone. So every rule here either
// reorders, selects or flags — and what a rule cannot fix without a fact becomes an
// owner QUESTION (CvOwnerQuestion), shown in the designer and never printed.

import type { CvLang, CvOwnerQuestion } from "./cvDocument";

// ── self-descriptors ───────────────────────────────────────────────────────────────
//
// technique accomplishment-statements-without-invention: "Results-driven",
// "passionate", "team player" carry no checkable content and are among the phrases
// recruiters most often report disliking. Removing them from GENERATED text is safe;
// in the seeker's OWN words they are flagged, never silently deleted — the person
// whose name is on the page decides.

export const SELF_DESCRIPTORS: Record<CvLang, readonly string[]> = {
  en: [
    "results-driven", "results-oriented", "passionate", "team player", "hard-working", "hardworking", "self-starter",
    "self-motivated", "detail-oriented", "go-getter", "highly motivated", "motivated", "proactive", "dynamic",
    "enthusiastic", "dedicated", "proven track record", "track record", "fast learner", "quick learner",
    "strategic thinker", "think outside the box", "synergy", "thought leader",
  ],
  cs: [
    "cílevědomý", "cílevědomá", "týmový hráč", "týmová hráčka", "pracovitý", "pracovitá", "komunikativní",
    "flexibilní", "spolehlivý", "spolehlivá", "proaktivní", "motivovaný", "motivovaná", "orientovaný na výsledky",
    "orientovaná na výsledky", "odolný vůči stresu", "odolná vůči stresu", "nadšený", "nadšená", "dynamický", "dynamická",
  ],
  de: [
    "teamfähig", "teamplayer", "belastbar", "zielorientiert", "ergebnisorientiert", "hochmotiviert", "motiviert",
    "engagiert", "zuverlässig", "leidenschaftlich", "dynamisch", "kommunikationsstark", "proaktiv", "flexibel",
  ],
  fr: [
    "esprit d'équipe", "dynamique", "motivé", "motivée", "passionné", "passionnée", "rigoureux", "rigoureuse",
    "proactif", "proactive", "orienté résultats", "orientée résultats", "force de proposition", "polyvalent", "polyvalente",
  ],
};

const DESCRIPTOR_PATTERNS: RegExp[] = Object.values(SELF_DESCRIPTORS)
  .flat()
  .map((d) => new RegExp(`(?<![\\p{L}\\d])${d.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/[-\s]/g, "[-\\s]?")}(?![\\p{L}\\d])`, "iu"));

/** The first self-descriptor in `text`, in any of the four languages, or null. */
export function descriptorIn(text: string): string | null {
  for (const re of DESCRIPTOR_PATTERNS) {
    const m = re.exec(text || "");
    if (m) return m[0];
  }
  return null;
}

/** The self-descriptor questions for the seeker's own lines: the headline, each summary
 *  sentence, each printed bullet — the line quoted verbatim, nothing removed. */
export function descriptorQuestions(input: {
  headline: string | null;
  summarySentences: readonly string[];
  roles: readonly { bullets: readonly { lead: string | null; text: string }[] }[];
}): CvOwnerQuestion[] {
  const out: CvOwnerQuestion[] = [];
  if (input.headline && descriptorIn(input.headline)) out.push({ kind: "self_descriptor", roleIndex: null, text: input.headline });
  for (const s of input.summarySentences) if (descriptorIn(s)) out.push({ kind: "self_descriptor", roleIndex: null, text: s });
  input.roles.forEach((r, roleIndex) => {
    for (const b of r.bullets) {
      const line = b.lead ? `${b.lead}: ${b.text}` : b.text;
      if (descriptorIn(line)) out.push({ kind: "self_descriptor", roleIndex, text: line });
    }
  });
  return out;
}

// ── the outcome ladder ─────────────────────────────────────────────────────────────
//
// technique accomplishment-statements-without-invention, "use the highest rung the
// record holds": 1 a measured result the owner supplied (a number with its unit), 2 a
// stated scale or scope (frequency, audience, a counted quantity in words), 3 a stated
// before/after or consequence without a number, 4 the action and the object alone — an
// honest duty line, a valid resting state. Descending is always honest; climbing needs
// a fact from the owner, so a rung-4 line becomes a question, never a guessed outcome.

export type OutcomeRung = 1 | 2 | 3 | 4;

function foldWords(text: string): string[] {
  return (text || "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .match(/[\p{L}\d]+/gu) ?? [];
}

const NUMBER_WORDS = new Set([
  "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "twenty", "thirty",
  "dozen", "dozens", "hundred", "hundreds", "thousand", "thousands", "million", "millions",
  "dva", "dve", "tri", "ctyri", "pet", "sest", "sedm", "osm", "devet", "deset", "stovky", "tisice",
  "zwei", "drei", "vier", "funf", "sechs", "sieben", "acht", "neun", "zehn", "hunderte", "tausende",
  "deux", "trois", "quatre", "cinq", "sept", "huit", "neuf", "dix", "centaines", "milliers",
]);

// Frequency, audience and reach — the scope words of rung 2 (folded).
const SCOPE_WORDS = new Set([
  "daily", "weekly", "monthly", "quarterly", "yearly", "annually", "annual", "leadership", "board", "executives",
  "nationwide", "international", "global", "company", "organisation", "organization", "across", "crossteam",
  "denne", "tydne", "mesicne", "ctvrtletne", "rocne", "vedeni", "napric", "celofiremni",
  "taglich", "wochentlich", "monatlich", "jahrlich", "geschaftsleitung", "unternehmensweit", "bereichsubergreifend",
  "quotidien", "hebdomadaire", "mensuel", "annuel", "direction", "transverse",
]);

// A change that has a size — stated without one, it is a missing metric (folded prefixes).
const QUANT_CHANGE = [
  "reduc", "increas", "improv", "decreas", "shorten", "acceler", "faster", "doubl", "halv", "boost", "lower", "grew",
  "cut", "sav", "fell", "rose", "dropped",
  "snizil", "snizen", "zvysil", "zvysen", "zlepsil", "zlepsen", "zkratil", "zrychlil", "usetril",
  "reduzier", "gesenkt", "erhoh", "gesteigert", "verbesser", "verkurz", "beschleunig", "eingespart",
  "redui", "augment", "amelior", "accelere", "raccourci", "economis",
];
// A consequence or a before/after without a size (folded prefixes).
const CONSEQUENCE = [
  "replac", "eliminat", "automat", "adopted", "became", "enabl",
  "nahradil", "zautomatizoval", "umoznil", "zavedl", "zavedla",
  "ersetz", "automatisier", "ermoglich", "eingefuhrt",
  "remplac", "automatis", "permis", "lance",
];

const startsAny = (word: string, stems: readonly string[]) => stems.some((s) => (s.length <= 3 ? word === s : word.startsWith(s)));

/** Digits that are an amount: not a bare year, not part of a month/year date, not glued
 *  to a name ("S3", "ISO27001" stays a name). */
function hasAmount(text: string): boolean {
  for (const m of (text || "").matchAll(/(?<![\p{L}\d./])\d+(?:[ \u00a0.,]\d{3})*(?:[.,]\d+)?(?![\p{L}\d/])/gu)) {
    const digits = m[0].replace(/\D/g, "");
    const after = (text.slice(m.index + m[0].length).match(/^\s*(%|x\b|×)/) ?? [""])[0];
    if (/^(?:19|20)\d\d$/.test(digits) && !after) continue;
    return true;
  }
  return false;
}

function statesChange(words: string[], text: string): boolean {
  return words.some((w) => startsAny(w, QUANT_CHANGE)) || /(?<![\p{L}])(from|von)\s.+\s(to|auf)\s/iu.test(text);
}

export function outcomeRung(text: string): OutcomeRung {
  const words = foldWords(text);
  const counted = words.some((w) => NUMBER_WORDS.has(w));
  const change = statesChange(words, text);
  if (hasAmount(text) || (counted && change)) return 1;
  if (counted || words.some((w) => SCOPE_WORDS.has(w))) return 2;
  if (change || words.some((w) => startsAny(w, CONSEQUENCE))) return 3;
  return 4;
}

/** A change with a size, stated without the size ("Reduced manual regression effort."). */
export function missingMetric(text: string): boolean {
  const words = foldWords(text);
  return outcomeRung(text) === 3 && words.some((w) => startsAny(w, QUANT_CHANGE));
}

/** Stable: the strongest rung first, the CV's own order breaking ties. */
export function rankByOutcome<T>(items: readonly T[], line: (t: T) => string): T[] {
  return items
    .map((item, i) => ({ item, i, r: outcomeRung(line(item)) }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.item);
}

// ── the recency budget ─────────────────────────────────────────────────────────────
//
// technique relevance-ordering-and-recency-compression: the current or most recent role
// 3-6 bullets, previous roles within about ten years 2-4, older ones 1-2, roles past
// about fifteen years a single line (title, employer, dates). Space decreases with age
// and distance from the target and never reaches zero for anything with a date: a
// compressed role keeps its interval, and what it holds back stays on the role.

export const BULLET_BUDGET = { current: 6, recent: 4, older: 2, offTarget: 2 } as const;
export const RECENT_YEARS = 10;
export const HORIZON_YEARS = 15;

const PRESENT = /present|now|current|today|dosud|současnost|soucasnost|nyní|heute|aktuell|aujourd'hui|actuel/i;

/** The year a role ended (the current year when it runs to the present), or null. */
export function endYearOf(dates: string | null, today: Date): number | null {
  if (!dates) return null;
  if (PRESENT.test(dates)) return today.getUTCFullYear();
  const years = dates.match(/(?:19|20)\d\d/g);
  return years ? Number(years[years.length - 1]) : null;
}

/** How many bullets a role may print: 0 = one line. `index` 0 is the most recent role. */
export function roleBudget(index: number, dates: string | null, today: Date): number {
  const end = endYearOf(dates, today);
  const age = end === null ? null : today.getUTCFullYear() - end;
  if (age !== null && age > HORIZON_YEARS) return 0;
  if (index === 0 || (dates !== null && PRESENT.test(dates))) return BULLET_BUDGET.current;
  if (age === null || age <= RECENT_YEARS) return BULLET_BUDGET.recent;
  return BULLET_BUDGET.older;
}

/** The outcome questions for the printed bullets: rung 4 asks what changed; a change
 *  stated without its size asks for the number. A one-line role asks nothing. */
export function outcomeQuestions(roles: readonly { compact: boolean; bullets: readonly { lead: string | null; text: string }[] }[]): CvOwnerQuestion[] {
  const out: CvOwnerQuestion[] = [];
  roles.forEach((r, roleIndex) => {
    if (r.compact) return;
    for (const b of r.bullets) {
      const line = b.lead ? `${b.lead}: ${b.text}` : b.text;
      if (outcomeRung(line) === 4) out.push({ kind: "no_outcome", roleIndex, text: line });
      else if (missingMetric(line)) out.push({ kind: "missing_metric", roleIndex, text: line });
    }
  });
  return out;
}
