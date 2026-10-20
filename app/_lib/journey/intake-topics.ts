// What one round of the role-intake dialog was ABOUT — a single `JourneyTopicCode`,
// or nothing.
//
// WHY A CODE AND NOT A SENTENCE. types.ts states the rule this module obeys: a journey
// row is `kind` + `facts` (+ an optional `topicCode`), and the sentence is rendered per
// locale from `journey.topics.<code>`. A classifier that returned prose would ship the
// dialog's own language — the seeded corpus is Czech — to a French reader.
//
// REFUSAL IS A RESULT, NOT A FAILURE. A round this module cannot place returns `null`,
// the row is written with `topic_code` NULL, and render-keys.ts falls back to the row's
// KIND (`journey.events.intakeRound`). "We could not tell what this round was about" and
// "this round was about the salary band" are different facts and are stored differently.
// Guessing to avoid a null would be the dishonest option: a wrong topic reads as a
// confident claim about what a hiring manager said.
//
// KEYLESS BY CONSTRUCTION. kp degrades gracefully with no API keys as a product
// property, so this classifier is deterministic keyword matching over the round's own
// text and reaches no model, no network and no subprocess. It is NOT a "fallback" that
// sits behind a model call: app/_lib/llm-config.ts's `LLM_USE_CASES` has no entry for
// topic classification, so there is no configured model to consult today. When one is
// added (a new use case there + its four catalog labels), it belongs in the BACKGROUND
// RUNNER that calls this module (late-bound-boot.ts, kind `intake_round`) — classify
// first, then write — never on the request path and never as a second write, because
// `intake_events` is append-only and has no UPDATE path to correct a row with.
//
// The vocabulary is IMPORTED from types.ts, never restated: the rule table below is
// keyed by `JourneyTopicCode`, so a code that is renamed or dropped is a tsc error here
// rather than a row nothing can render.

import { isJourneyTopicCode, type JourneyTopicCode } from "./types";

/**
 * The subset of the closed vocabulary an INTAKE round can be placed in — the ten codes
 * types.ts groups under "role intake". The other seven are interview-round topics (a
 * candidate's availability, a guardrail hit) and cannot be produced by a conversation
 * that happens before any candidate exists; emitting one would be a category error the
 * board would render as a confident lie.
 */
export const INTAKE_TOPIC_CODES = [
  "backfill-reason",
  "role-shape",
  "role-title",
  "seniority",
  "must-have-skills",
  "team-context",
  "salary-band",
  "work-mode",
  "first-90-days",
  "timeline",
] as const satisfies readonly JourneyTopicCode[];

export type IntakeTopicCode = (typeof INTAKE_TOPIC_CODES)[number];

/**
 * Fold a string to its matching form: lower case, and combining marks stripped so the
 * Czech corpus ("náhrada", "nástup", "mzdové rozpětí") matches keywords written in plain
 * ASCII — and so a requestor typing without diacritics, which is ordinary in Czech chat,
 * is classified identically. Purely additive: it can merge two spellings, never invent a
 * word that was not there.
 */
function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase();
}

/** Escape a keyword for use inside a RegExp source. */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * A keyword matcher with LETTER boundaries rather than `\b`. `\b` is ASCII-only, so
 * `\bvypoved\b` would happily match inside a longer word once diacritics are folded
 * away, and `\bkdy\b` would fire on "nekdy" ("sometimes") — the difference between
 * "when do you need them to start" and "sometimes we do that". Lookaround on
 * `\p{L}\p{N}` is the same test written for the alphabet this product actually speaks.
 */
function keywordRe(keyword: string): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(fold(keyword))}(?![\\p{L}\\p{N}])`, "u");
}

/**
 * One rule per topic. `cues` are folded at module load, so the table below may be
 * written in the natural spelling of each language.
 *
 * ORDER IS THE TIE-BREAK, and it is the rule table's only piece of judgement: a round
 * that scores equally on two topics is placed in the one that appears FIRST here, most
 * specific first. That makes the classifier a pure function of the text — the same round
 * classifies the same way on every machine, in every process, forever — which is what
 * lets a backfilled row and a live row be compared at all.
 *
 * Four languages because the product ships four (`i18n/locales.ts`), and because the
 * seeded intake corpus is Czech: an English-only rule table would refuse 143 of the
 * turns that exist today and the board would show a column of unplaced rounds.
 */
const RULES: { topic: IntakeTopicCode; cues: readonly string[] }[] = [
  {
    // Why the seat is open at all, when the answer is "someone left". The most specific
    // intake topic and therefore first: a backfill round almost always ALSO names the
    // team and the seniority, and those rules must not outvote it.
    topic: "backfill-reason",
    cues: [
      "nahrada", "nahradit", "nahradu", "odesel", "odesla", "odchod", "vypoved", "dal vypoved", "po nem", "po ni",
      "backfill", "replacement", "replace", "resigned", "resignation", "left the team", "leaving", "quit", "departure",
      "nachfolge", "ersatz", "gekundigt", "verlasst",
      "remplacement", "remplacer", "demission", "depart",
    ],
  },
  {
    // The opposite answer to the same question: a seat that did not exist before.
    topic: "role-shape",
    cues: [
      "nova role", "nova pozice", "novy tym", "rozsireni", "rozsirujeme", "navyseni", "prvni takova",
      "new role", "new position", "brand new", "net new", "expansion", "expanding", "growth hire", "headcount", "first hire",
      "neue rolle", "neue stelle", "wachstum", "neu geschaffen",
      "nouveau poste", "nouveau role", "creation de poste",
    ],
  },
  {
    topic: "role-title",
    cues: [
      "nazev pozice", "nazev role", "titul", "jak se ta pozice", "pojmenovat", "pojmenujeme",
      "job title", "role title", "title", "call the role", "name the role", "named",
      "stellenbezeichnung", "jobtitel", "bezeichnung",
      "intitule", "intitule du poste", "titre du poste",
    ],
  },
  {
    topic: "seniority",
    cues: [
      "seniorita", "seniorni", "seniorniho", "juniorni", "medior", "zkusenosti let", "let praxe", "uroven",
      "senior", "junior", "mid-level", "midlevel", "staff", "principal", "lead", "seniority", "years of experience", "level",
      "berufserfahrung", "erfahrungsstufe",
      "niveau", "annees d experience", "experience requise",
    ],
  },
  {
    topic: "must-have-skills",
    cues: [
      "dovednosti", "znalosti", "musi umet", "musi znat", "pozadavky", "nutne", "nezbytne", "zkusenost s", "ovladat",
      "must have", "must-have", "required skills", "requirements", "hard skills", "non-negotiable", "proficiency", "experience with",
      "anforderungen", "kenntnisse", "faehigkeiten", "voraussetzungen",
      "competences", "exigences", "indispensable", "maitrise",
    ],
  },
  {
    topic: "team-context",
    cues: [
      "tym", "tymu", "kolegove", "oddeleni", "reportovat", "nadrizeny", "manazer", "s kym bude",
      "team", "squad", "department", "reports to", "reporting", "manager", "stakeholders", "colleagues", "work with",
      "abteilung", "vorgesetzter", "zusammenarbeit",
      "equipe", "service", "responsable", "collegues",
    ],
  },
  {
    topic: "salary-band",
    cues: [
      "mzda", "mzdu", "mzdove", "plat", "platu", "platove", "rozpocet", "rozpeti", "czk", "kc", "hruba",
      "salary", "compensation", "budget", "band", "pay", "package", "rate", "equity", "bonus",
      "gehalt", "vergutung", "lohn",
      "salaire", "remuneration", "budget salarial",
    ],
  },
  {
    topic: "work-mode",
    cues: [
      "remote", "hybridni", "hybrid", "kancelar", "kancelare", "na dalku", "z domova", "home office", "docházka", "prezencne",
      "on-site", "onsite", "in office", "in-office", "work from home", "wfh", "relocation", "days a week in",
      "buro", "homeoffice", "vor ort",
      "teletravail", "presentiel", "bureau",
    ],
  },
  {
    // What "good" looks like once they have started — distinct from the skills that get
    // them hired, and the round a hiring manager most often has never thought about.
    topic: "first-90-days",
    cues: [
      "prvnich 90", "90 dni", "prvni tri mesice", "prvni mesice", "za pul roku", "zapracovani", "uspech",
      "first 90", "first ninety", "first three months", "first month", "ramp up", "ramp-up", "onboarding", "success looks like", "by month three",
      "erste 90", "einarbeitung", "erfolgreich",
      "premiers 90", "trois premiers mois", "montee en competence",
    ],
  },
  {
    // LAST on purpose: "kdy" / "when" turns up in rounds that are really about something
    // else, so timeline only wins when nothing more specific scored at all.
    topic: "timeline",
    cues: [
      "nastup", "nastoupit", "do kdy", "termin", "kdy potrebujete", "co nejdriv", "spechame", "naberovy termin", "uzaverka",
      "start date", "starting", "deadline", "timeline", "by when", "asap", "urgent", "notice period", "how soon",
      "eintritt", "starttermin", "kundigungsfrist", "dringend",
      "date de debut", "delai", "urgent", "preavis",
    ],
  },
];

/** The compiled table. Built once at module load — the classifier itself allocates
 *  nothing per call, which is what lets the backfill run it over a whole corpus. */
const COMPILED: { topic: IntakeTopicCode; res: RegExp[] }[] = RULES.map((rule) => ({
  topic: rule.topic,
  // Distinct cues only: a rule that lists the same folded word twice would otherwise
  // score double for one occurrence and quietly outrank a better-matched rule.
  res: [...new Set(rule.cues.map(fold))].map(keywordRe),
}));

/** One round of the intake dialog, as the writer sees it. Both halves are matched: the
 *  agent's question carries the topic even when the requestor answers "yes". */
export type IntakeRound = {
  /** What the intake agent asked. Optional — the opener has no question before it. */
  question?: string;
  /** What the requestor replied. */
  answer?: string;
};

/**
 * Place one round in the closed vocabulary, or refuse.
 *
 * NEVER THROWS. It is called from a background runner and from the boot backfill, and in
 * both a thrown error would cost the round its history row — the exact loss this whole
 * package exists to stop. A malformed input answers `null`, which is a row the board can
 * still render.
 */
export function classifyIntakeRound(round: IntakeRound): JourneyTopicCode | null {
  try {
    const text = fold(`${round.question ?? ""}\n${round.answer ?? ""}`);
    if (!text.trim()) return null;
    let best: { topic: IntakeTopicCode; score: number } | null = null;
    for (const rule of COMPILED) {
      let score = 0;
      for (const re of rule.res) if (re.test(text)) score += 1;
      // STRICTLY greater: the first rule to reach a score keeps it, which is what makes
      // the table's order the documented tie-break rather than an accident of iteration.
      if (score > 0 && (!best || score > best.score)) best = { topic: rule.topic, score };
    }
    if (!best) return null;
    // Belt and braces against a future edit to the table: the guard from types.ts is the
    // one authority on what a topic code is, and a value it rejects must never be written
    // to a column the renderer will look up in the catalogs.
    return isJourneyTopicCode(best.topic) ? best.topic : null;
  } catch {
    /* best-effort: a round we cannot classify is a legitimate row with no topic, and a
       classifier is never allowed to be the reason a round has no history at all. */
    return null;
  }
}
