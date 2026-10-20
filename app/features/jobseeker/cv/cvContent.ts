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

// ── skills: evidenced, ordered, capped ─────────────────────────────────────────────
//
// technique evidenced-skills-over-self-ratings: grouped, not ranked; tied to evidence
// (a skill that also appears in a role or project line is an index into the
// experience); levels in words, never a meter; a long list cut by relevance and recency,
// never by the owner's rating. A skill listed nowhere else is FLAGGED ("where did you use
// it?"), not deleted — a self-asserted skill is real information. A generic soft skill
// ("communication", "teamwork") is the purest self-descriptor on the page: flagged too.

/** The most skills the sheet lists: "ten evidenced items" beat a twenty-item wall. */
export const SKILL_CAP = 15;

const SOFT_SKILLS = new Set([
  "communication", "communication skills", "leadership", "teamwork", "team work", "problem solving", "problem-solving",
  "critical thinking", "time management", "adaptability", "flexibility", "creativity", "interpersonal skills",
  "komunikace", "komunikativnost", "týmová práce", "flexibilita", "samostatnost", "kreativita",
  "kommunikation", "teamfähigkeit", "teamarbeit", "flexibilität", "kreativität",
  "travail d'équipe", "autonomie", "créativité", "adaptabilité",
]);

export function isSoftSkill(name: string): boolean {
  return SOFT_SKILLS.has(name.trim().toLocaleLowerCase());
}

function wordsOf(text: string): string[] {
  return foldWords(text).map((w) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w));
}

/** Whether `name` occurs in `text` as a whole-word run (folded, plural-tolerant). */
export function mentions(text: string, name: string): boolean {
  const hay = wordsOf(text);
  const needle = wordsOf(name);
  if (!needle.length) return false;
  for (let i = 0; i + needle.length <= hay.length; i++) if (needle.every((w, j) => hay[i + j] === w)) return true;
  return false;
}

type SkillItem = { name: string; level: string | null };
type SkillGroup = { title: string | null; items: SkillItem[]; trimmed?: SkillItem[] };

/** Order and cap the skill groups by evidence and recency. `evidence[i]` is the text of
 *  the i-th most recent role or project (index 0 = the most recent). Returns the groups
 *  (each printed list evidenced-first, then most recently used, then the CV's order;
 *  items past the cap kept as `trimmed`), and the owner questions: listed-only skills and
 *  soft skills. Nothing is renamed and no level is invented. */
export function orderSkills(groups: readonly SkillGroup[], evidence: readonly string[], cap = SKILL_CAP): { groups: SkillGroup[]; questions: CvOwnerQuestion[] } {
  const questions: CvOwnerQuestion[] = [];
  const ranked = groups.flatMap((g, gi) =>
    g.items.map((item, ii) => {
      const used = evidence.findIndex((text) => mentions(text, item.name));
      if (isSoftSkill(item.name)) questions.push({ kind: "self_descriptor", roleIndex: null, text: item.name });
      else if (used < 0) questions.push({ kind: "listed_only", roleIndex: null, text: item.name });
      return { gi, ii, item, used: used < 0 ? Number.POSITIVE_INFINITY : used, soft: isSoftSkill(item.name) };
    })
  );
  const order = [...ranked].sort((a, b) => Number(a.soft) - Number(b.soft) || a.used - b.used || a.gi - b.gi || a.ii - b.ii);
  const kept = new Set(order.slice(0, cap));
  const out: SkillGroup[] = groups.map((g) => ({ title: g.title, items: [], trimmed: [] }));
  for (const r of order) (kept.has(r) ? out[r.gi]!.items : out[r.gi]!.trimmed!).push(r.item);
  // Groups keep the CV's own order: grouping is the owner's; the evidence order is inside.
  return { groups: out.filter((g) => g.items.length), questions };
}

// ── languages on the common European scale ─────────────────────────────────────────
//
// "German - B2", "Czech - native": the level on the scale the reader knows, when the
// record states it. A CEFR code is kept as the code; a first-language word becomes the
// document's word for "native"; any other stated word stays the CV's own ("fluent" has
// no exact CEFR equivalent, so it is not converted). No level is inferred.

export const NATIVE_WORD: Record<CvLang, string> = { en: "native", cs: "rodilý mluvčí", de: "Muttersprache", fr: "langue maternelle" };

const NATIVE = /(?<![\p{L}])(native|mother tongue|first language|rodil[ýá] mluvč[íi]|mateřsk[ýá] jazyk|mateřština|muttersprache|langue maternelle)(?![\p{L}])/iu;
const CEFR = /(?<![\p{L}\d])([ABC][12])(?![\p{L}\d])/u;

/** A stated language split into its name and level: "German (B2)", "Czech – native",
 *  "English". `level` is a CEFR code, "native", the record's own other word ("fluent"),
 *  or null when none is stated — never inferred. Null when there is no usable name. */
export function splitLanguage(raw: string): { name: string; level: string | null } | null {
  const text = raw.replace(/\s+/g, " ").trim();
  if (!text) return null;
  // A hyphen separates a level only after a space ("English - C1"): "Swiss-German" is a name.
  const paren = /^(.*?)\s*[(\[]([^)\]]*)[)\]]\s*$/.exec(text) ?? /^(.*?)\s*(?:[–—:]|\s-)\s*(.+)$/.exec(text);
  const name = (paren ? paren[1]! : text).trim();
  const stated = (paren ? paren[2]! : "").trim();
  if (!name || name.length > 40) return null;
  const code = CEFR.exec(stated.toUpperCase());
  return { name, level: code ? code[1]! : NATIVE.test(stated) ? "native" : stated || null };
}

/** One stated language as the sheet sets it: "Name – level" when a level is stated. */
export function languageLine(raw: string, lang: CvLang): string | null {
  const split = splitLanguage(raw);
  if (!split) return null;
  const cased = split.name.charAt(0).toLocaleUpperCase() + split.name.slice(1);
  const level = split.level === "native" ? NATIVE_WORD[lang] : split.level;
  return level ? `${cased} – ${level}` : cased;
}

/** The languages block of the CV ("Czech (native), English (C1)") — or, with none, the
 *  profile's list — as sheet lines, in the CV's order. */
export function languageLines(blockLines: readonly string[] | null, profileLanguages: readonly string[], lang: CvLang): string[] {
  const items = blockLines && blockLines.length ? blockLines.flatMap((l) => l.split(/\s*[,;·•|]\s*/)) : [...profileLanguages];
  const out: string[] = [];
  for (const item of items) {
    const line = languageLine(item, lang);
    if (line && !out.includes(line)) out.push(line);
  }
  return out;
}

// ── market conventions and personal data ───────────────────────────────────────────
//
// registry cv-presentation-and-parseability/market-conventions-and-personal-data: every
// protected-attribute field defaults to OFF in every market — photo, birth date, age,
// marital status, children, nationality. A template slot is not a reason to fill it, and
// a line the CV volunteered is not either: the document model has no field for any of
// them, and a line that states one is never read into the headline, a skill or a sentence.
// Offering a market's convention (a photo in Germany) is an owner choice for a later
// designer control, stated with its trade-off — never a default.

const PERSONAL_LABEL =
  /^(date of birth|birth ?date|born|dob|age|marital status|family status|civil status|nationality|citizenship|children|photo|photograph|religion|datum narozen[íi]|narozen[aá]?|nar\.|v[ěe]k|rodinn[ýy] stav|n[áa]rodnost|st[áa]tn[íi] ob[čc]anstv[íi]|ob[čc]anstv[íi]|d[ěe]ti|fotografie|foto|geburtsdatum|geboren|geb\.|alter|familienstand|staatsangeh[öo]rigkeit|nationalit[äa]t|kinder|konfession|date de naissance|n[ée]e? le|[âa]ge|situation familiale|[ée]tat civil|nationalit[ée]|enfants)(?=\s*:|\s+[\-–]\s|\s+\d)/iu;
const PERSONAL_VALUE =
  /^(married|single|divorced|widowed|ženatý|ženatá|vdaná|svobodn[ýá]|rozveden[ýá]|verheiratet|ledig|geschieden|verwitwet|mari[ée]e?|c[ée]libataire|divorc[ée]e?)[.,;]?$/iu;
const PERSONAL_PHRASE = /(?<![\p{L}])(\d{1,2}\s*years?\s*old|\d{1,2}\s*jahre\s*alt|\d{1,2}\s*ans\b)/iu;

/** A line (or sentence) that states a protected personal attribute: a labelled field
 *  ("Date of birth: …", "Nar. 1990"), a bare marital status, or an age. A label must be
 *  followed by a colon, a spaced dash or a digit, so "Age-verification flow" is not one. */
export function isPersonalData(line: string): boolean {
  const text = (line || "").trim();
  return PERSONAL_LABEL.test(text) || PERSONAL_VALUE.test(text) || PERSONAL_PHRASE.test(text);
}

/** The word for "to the present" in each market's date ranges ("03/2020 – dosud"). */
export const PRESENT_WORD: Record<CvLang, string> = { en: "present", cs: "dosud", de: "heute", fr: "aujourd'hui" };

// ── accepted polish edits: one source of truth ─────────────────────────────────────
//
// technique machine-rewrite-fidelity-contract, rule 5: accepted changes flow into the ONE
// document. A polished text living beside the printed one is a second source of truth —
// the owner accepts improvements that never reach the page. So the designed CV (the /me
// preview, the print page, the PDF) is built from the CV text with exactly the line edits
// the seeker ACCEPTED in the CV studio applied — never a suggestion they did not accept,
// never the model's own redraft. Rule 6: an edit is bound to the text it judged — it
// applies only while its `before` is still, verbatim, in the CV text (a re-imported CV
// that changed the line drops it rather than re-anchoring it by a fuzzy match).

export type AcceptedEdit = { before: string; after: string };

type DialogLike = { kind: string; createdAt?: string; updatedAt: string; artifact: unknown };

function appliedOf(artifact: unknown): AcceptedEdit[] {
  const raw = artifact && typeof artifact === "object" ? (artifact as { applied?: unknown }).applied : null;
  return (Array.isArray(raw) ? raw : [])
    .filter((a): a is AcceptedEdit => !!a && typeof a === "object" && typeof (a as AcceptedEdit).before === "string" && typeof (a as AcceptedEdit).after === "string")
    .filter((a) => a.before.trim())
    .map((a) => ({ before: a.before, after: a.after }));
}

/** The seeker's accepted edits across their CV-studio dialogs, oldest dialog first, one
 *  per line (a later acceptance for the same line wins). Fit dialogs carry none. */
export function acceptedEditsOf(dialogs: readonly (DialogLike | null | undefined)[]): AcceptedEdit[] {
  const polish = dialogs
    .filter((d): d is DialogLike => !!d && d.kind === "cv_polish")
    .sort((a, b) => (a.createdAt ?? a.updatedAt).localeCompare(b.createdAt ?? b.updatedAt) || a.updatedAt.localeCompare(b.updatedAt));
  const byLine = new Map<string, AcceptedEdit>();
  for (const d of polish) for (const edit of appliedOf(d.artifact)) {
    byLine.delete(edit.before);
    byLine.set(edit.before, edit);
  }
  return [...byLine.values()];
}

/** `text` with each accepted edit applied once, in order, while its line is still there. */
export function applyAcceptedEdits(text: string, edits: readonly AcceptedEdit[] | null | undefined): string {
  let out = text || "";
  for (const e of edits ?? []) {
    const at = e.before ? out.indexOf(e.before) : -1;
    if (at >= 0) out = out.slice(0, at) + e.after + out.slice(at + e.before.length);
  }
  return out;
}
