// The seeker's CV as a DOCUMENT — pure, no React, so `node --test` holds it.
//
// An imported CV reaches the product as two things: the profile the draft read out of it
// (name, skills with provenance, dated roles, languages, education) and the raw text it was
// read from. This module turns both into the structure a designed CV is laid out from —
// identity, contacts, a summary, dated roles with bullets, the seeker's OWN skill groups,
// education, languages — so a template can make it look good and a PDF can keep that look.
//
// "Better expressed" is deliberately narrow and deterministic: canonical spellings of
// technology names (NextJS -> Next.js, Postgres -> PostgreSQL), a small dictionary of
// common misspellings (Continous -> Continuous), line-wrap hyphens re-joined
// (prototype-to- production), a sentence's first letter capitalised, a weak "Responsible
// for" opener tightened. Every change is RECORDED in `improvements`, so the page can say
// exactly what was tidied, and nothing is ever invented: no new claim, no new number, no
// guessed date (registry technique text-extraction-damage-and-repair: repair is reasoning
// about the encoding, never about the content).

import type { JobseekerPreferences } from "@/app/_lib/jobseeker/types";
import type { ProfilePayload } from "@/app/features/shared/profileTypes";

export type CvContact = { kind: "email" | "phone" | "linkedin" | "github" | "url"; value: string; href: string };
/** `compact`: the tailoring pass (cvTailor.ts) set this role as one line — it stays, in
 *  its place, but its bullets are not printed. */
export type CvRole = { role: string; org: string | null; dates: string | null; bullets: CvBullet[]; compact?: boolean };
/** A bullet may open with a lead phrase ("RAG pipeline design:") the template sets in bold.
 *  `emphasis` = [start, end) ranges of `text` the template bolds (a target term; cvTailor.ts). */
export type CvBullet = { lead: string | null; text: string; emphasis?: [number, number][] };
/** `emphasis`: the item names a skill the target asks for (cvTailor.ts); the template bolds it. */
export type CvSkillItem = { name: string; level: string | null; emphasis?: boolean };
/** `title` is the CV's own group label ("LLM related"); null = the template's localised "Skills". */
export type CvSkillGroup = { title: string | null; items: CvSkillItem[] };
export type CvEducation = { title: string; detail: string | null; dates: string | null };
/** A deterministic wording change (this file). */
export type CvEdit = { kind: "term" | "spelling" | "hyphen" | "capital" | "opener"; before: string; after: string };
/** A tailoring move (cvTailor.ts): what led BEFORE and what leads now, `where` it happened
 *  (a role, a skill group), `n` for a counted move (terms set in bold). Order and emphasis
 *  only — never a new word. */
export type CvTailorMove = {
  kind: "tailor";
  move: "summary" | "bullets" | "groups" | "items" | "emphasis" | "compact" | "objective";
  before: string;
  after: string;
  where: string | null;
  n: number;
};
export type CvImprovement = CvEdit | CvTailorMove;

export type CvDocument = {
  /** The language the CV is written in; the template's headings follow it. */
  lang: CvLang;
  name: string;
  headline: string | null;
  /** The seeker's STATED direction under the headline ("Seeking: AI Engineer roles"), set
   *  only by the tailoring pass — a preference, labelled as one, never a held title. */
  objective?: string | null;
  location: string | null;
  contacts: CvContact[];
  summary: string | null;
  experience: CvRole[];
  skills: CvSkillGroup[];
  education: CvEducation[];
  languages: string[];
  improvements: CvImprovement[];
};

// ── canonical terms ────────────────────────────────────────────────────────────────
//
// Spelling of a technology name, not a claim about it: "postgres" and "PostgreSQL" name
// the same thing, and a reader who knows the field reads the wrong casing as carelessness.

const TERMS: [RegExp, string][] = [
  [/\bnext\.?js\b/gi, "Next.js"],
  [/\breact\.?js\b/gi, "React"],
  [/\bnode\.?js\b|\bnodejs\b/gi, "Node.js"],
  [/\bvue\.?js\b/gi, "Vue.js"],
  [/\bexpress\s?\.?js\b/gi, "Express.js"],
  // A bare "js" beside a slash or a bracket ("python/js") — never the ".js" of a name.
  [/(?<=[/(])js(?![\p{L}\d])|(?<![.\p{L}\d])js(?=[/)])/gu, "JS"],
  [/\bpostgres(?:ql)?\b/gi, "PostgreSQL"],
  [/\bmongo\s?db\b/gi, "MongoDB"],
  [/\bmysql\b/gi, "MySQL"],
  [/\bfastapi\b/gi, "FastAPI"],
  [/\bjavascript\b/gi, "JavaScript"],
  [/\btypescript\b/gi, "TypeScript"],
  [/\bgithub\b/gi, "GitHub"],
  [/\bgitlab\b/gi, "GitLab"],
  [/\bgraphql\b/gi, "GraphQL"],
  [/\blangchain\b/gi, "LangChain"],
  [/\bopenai\b/gi, "OpenAI"],
  [/\bkubernetes\b/gi, "Kubernetes"],
  [/\bdocker\b/gi, "Docker"],
  [/\bterraform\b/gi, "Terraform"],
  [/\bjira\b/gi, "Jira"],
  [/\bconfluence\b/gi, "Confluence"],
  [/\bfigma\b/gi, "Figma"],
  [/\bpython\b/gi, "Python"],
  [/\bkafka\b/gi, "Kafka"],
  [/\bci\/cd\b/gi, "CI/CD"],
  [/\bui\/ux\b/gi, "UI/UX"],
];

// Acronyms written in lower or title case ("rest api", "Llm"). Words that are also
// ordinary English ("rest", "soap", "qa") are read as the acronym only beside another
// technical token ("Rest/Graph", "rest API") — "the rest of the team" stays prose.
const ACRONYMS = new Set(["api", "apis", "sql", "llm", "llms", "rag", "mcp", "uml", "aws", "gcp", "seo", "crm", "erp", "sdk", "rpc", "etl"]);
const AMBIGUOUS = new Set(["rest", "soap", "qa"]);

function acronymOf(word: string): string {
  const lower = word.toLowerCase();
  return lower.endsWith("s") && ACRONYMS.has(lower.slice(0, -1)) ? lower.slice(0, -1).toUpperCase() + "s" : lower.toUpperCase();
}

const MISSPELLINGS: Record<string, string> = {
  continous: "continuous",
  developement: "development",
  managment: "management",
  enviroment: "environment",
  experiance: "experience",
  sucessful: "successful",
  succesful: "successful",
  responsability: "responsibility",
  implemention: "implementation",
  maintainance: "maintenance",
  collegues: "colleagues",
  knowlege: "knowledge",
  architecure: "architecture",
  infrastucture: "infrastructure",
  perfomance: "performance",
};

/** Apply the canonical spellings and misspelling fixes to one string, recording each. */
export function polishTerms(text: string, log: CvImprovement[]): string {
  let out = text;
  for (const [re, canonical] of TERMS) {
    out = out.replace(re, (m: string) => {
      if (m !== canonical) log.push({ kind: "term", before: m, after: canonical });
      return canonical;
    });
  }
  // Unicode-aware word edges: JS `\b` is ASCII-only, so "Každan" would read as "Ka" + "dan".
  out = out.replace(/(?<![\p{L}\d])(\p{L}+)(?![\p{L}\d])/gu, (word: string, _w: string, offset: number, all: string) => {
    const lower = word.toLowerCase();
    if (word === word.toUpperCase()) return word;
    let next: string | null = null;
    if (ACRONYMS.has(lower)) next = acronymOf(word);
    else if (AMBIGUOUS.has(lower)) {
      const before = all.slice(Math.max(0, offset - 1), offset);
      const after = all.slice(offset + word.length, offset + word.length + 6);
      if (before === "/" || /^\/|^\s+apis?(?![\p{L}])/iu.test(after)) next = word.toUpperCase();
    }
    if (!next || next === word) return word;
    log.push({ kind: "term", before: word, after: next });
    return next;
  });
  out = out.replace(/(?<![\p{L}\d])(\p{L}+)(?![\p{L}\d])/gu, (m: string) => {
    const fix = MISSPELLINGS[m.toLowerCase()];
    if (!fix) return m;
    const next = m[0] === m[0]!.toUpperCase() ? fix[0]!.toUpperCase() + fix.slice(1) : fix;
    log.push({ kind: "spelling", before: m, after: next });
    return next;
  });
  return out;
}

// ── contacts and header ────────────────────────────────────────────────────────────

const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const PHONE = /\+?\d[\d ().-]{7,}\d/g;
const URLISH = /\b(?:https?:\/\/)?(?:www\.)?(?:linkedin\.com\/[\w\-/%]+|github\.com\/[\w\-/]+|[\w-]+\.(?:dev|io|me|com|cz|eu|net|org)\/[\w\-/]*)/gi;

/** Contacts are read from the header only — the lines before the first section heading
 *  (at most 12) — so a date range or a client's phone inside a role is never one. */
export function findContacts(text: string): CvContact[] {
  const lines = (text || "").split(/\r?\n/).slice(0, 12);
  const firstHeading = lines.findIndex((l) => sectionOf(l.trim()) !== null);
  const head = (firstHeading < 0 ? lines : lines.slice(0, firstHeading)).join("\n");
  const out: CvContact[] = [];
  const seen = new Set<string>();
  const push = (c: CvContact) => {
    const key = c.kind + ":" + c.value.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(c);
    }
  };
  for (const m of head.match(EMAIL) ?? []) push({ kind: "email", value: m, href: `mailto:${m}` });
  for (const m of head.match(PHONE) ?? []) {
    const digits = m.replace(/\D/g, "");
    // A date range ("2019 - 2020") or a year list is not a phone number.
    if (digits.length < 9 || /^(19|20)\d\d(19|20)\d\d$/.test(digits)) continue;
    push({ kind: "phone", value: m.trim(), href: `tel:${m.replace(/[^\d+]/g, "")}` });
  }
  for (const m of head.match(URLISH) ?? []) {
    const bare = m.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/$/, "");
    const kind = /linkedin\.com/i.test(bare) ? "linkedin" : /github\.com/i.test(bare) ? "github" : "url";
    push({ kind, value: bare, href: `https://${bare}` });
  }
  return out;
}

// Short uppercase words that are acronyms in a CV header or a group label. Anything else
// in an ALL-CAPS line is a shouted word ("WEB DEV" -> "Web Dev").
const KEEP_UPPER = new Set(["AI", "IT", "SW", "HW", "QA", "UX", "UI", "HR", "BI", "ML", "DB", "PM", "BA", "CEO", "CTO", "CFO", "COO", "VP", "EU", "USA", "UK", "SAP", "GIS", ...[...ACRONYMS].map((a) => a.toUpperCase())]);

function titleCase(line: string): string {
  // "MICHAL KAŽDAN" -> "Michal Každan"; a known acronym stays ("AI", "SW").
  return line
    .split(/(\s+|&|\/)/)
    .map((w) => (KEEP_UPPER.has(w) ? w : w.charAt(0).toLocaleUpperCase() + w.slice(1).toLocaleLowerCase()))
    .join("");
}

function isShouting(line: string): boolean {
  const letters = [...line].filter((c) => /\p{L}/u.test(c));
  return letters.length >= 4 && letters.every((c) => c === c.toLocaleUpperCase());
}

// ── sections ───────────────────────────────────────────────────────────────────────

const SECTION_WORDS: Record<string, string[]> = {
  summary: ["profile", "summary", "about", "about me", "profil", "shrnutí", "o mně", "zusammenfassung", "über mich", "résumé", "profil professionnel"],
  experience: ["experience", "work experience", "employment", "prior experience", "career", "zkušenosti", "pracovní zkušenosti", "praxe", "berufserfahrung", "erfahrung", "expérience", "expérience professionnelle"],
  education: ["education", "vzdělání", "ausbildung", "bildung", "formation"],
  skills: ["skills", "dovednosti", "kenntnisse", "fähigkeiten", "compétences", "technical skills", "tech stack"],
  languages: ["languages", "jazyky", "sprachen", "langues"],
};
const DATE_RANGE = /((?:0?[1-9]|1[0-2])[./](?:19|20)\d\d|(?:19|20)\d\d)\s*(?:-|–|—|to)\s*((?:0?[1-9]|1[0-2])[./](?:19|20)\d\d|(?:19|20)\d\d|present|now|current|dosud|současnost|heute|aujourd'hui)/i;

function sectionOf(line: string): string | null {
  const bare = line.replace(DATE_RANGE, "").trim().replace(/[:：\-–—#*_ ]+$/g, "").toLocaleLowerCase();
  if (!bare || bare.length > 40) return null;
  for (const [kind, words] of Object.entries(SECTION_WORDS)) if (words.includes(bare)) return kind;
  return null;
}

type Block = { kind: string | null; title: string; lines: string[]; dates: string | null };

/** Cut the text into blocks at every heading: a known section word, or an unknown ALL-CAPS
 *  label (a sidebar's own skill group, "LLM RELATED"). */
export function blocksOf(text: string): Block[] {
  const blocks: Block[] = [{ kind: "header", title: "", lines: [], dates: null }];
  for (const raw of (text || "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) {
      blocks[blocks.length - 1]!.lines.push("");
      continue;
    }
    const kind = sectionOf(line);
    const label = line.replace(DATE_RANGE, "").trim();
    if (kind || (isShouting(label) && label.length <= 30 && blocks.length > 0 && blocks[0]!.lines.filter(Boolean).length >= 2)) {
      blocks.push({ kind: kind ?? "group", title: label, lines: [], dates: line.match(DATE_RANGE)?.[0] ?? null });
      continue;
    }
    blocks[blocks.length - 1]!.lines.push(line);
  }
  return blocks;
}

// ── bullets ────────────────────────────────────────────────────────────────────────

const ABBREVIATION = /(?:(?:^|[\s(])(?:inc|ltd|co|corp|llc|gmbh|e\.g|i\.e|etc|vs|approx|dr|mr|ms|no|nr|tel|resp|mj|tzv|např|atd)\.|(?:\p{L}\.){2,})$/iu;

/** A sentence ends at . ! ? before the next word, whatever its case (a wrapped CV often
 *  starts the next line lower-case) — except after an abbreviation ("s.r.o.", "Inc.").
 *  Every piece is kept verbatim; only whitespace at the cut is dropped. */
export function splitSentences(body: string): string[] {
  const parts: string[] = [];
  for (const piece of (body || "").split(/(?<=[.!?])\s+(?=[\p{L}\d])/u)) {
    const prev = parts[parts.length - 1];
    if (prev !== undefined && ABBREVIATION.test(prev)) parts[parts.length - 1] = `${prev} ${piece}`;
    else parts.push(piece);
  }
  return parts.map((part) => part.trim()).filter((part) => part.length > 1);
}

/** Wrapped lines rejoined ("prototype-to-\nproduction"), then cut into sentence bullets. */
export function bulletsOf(text: string, log: CvImprovement[]): CvBullet[] {
  let body = (text || "").replace(/\s+/g, " ").trim();
  // "prototype-to- production": a hyphen the line wrap left open. Recorded with the whole
  // compound so the change reads as what it is.
  body = body.replace(/([\p{L}-]*\p{L})- (\p{Ll}+)/gu, (m, a: string, b: string) => {
    log.push({ kind: "hyphen", before: m, after: `${a}-${b}` });
    return `${a}-${b}`;
  });
  return splitSentences(body).map((part) => {
    let s = polishTerms(part, log);
    const opener = /^responsible for\s+/i.exec(s);
    if (opener) {
      const rest = s.slice(opener[0].length);
      log.push({ kind: "opener", before: opener[0].trim(), after: "Owned" });
      s = `Owned ${rest}`;
    }
    if (/^\p{Ll}/u.test(s)) {
      log.push({ kind: "capital", before: s.slice(0, 12), after: s.charAt(0).toLocaleUpperCase() + s.slice(1, 12) });
      s = s.charAt(0).toLocaleUpperCase() + s.slice(1);
    }
    const lead = /^([^:.]{3,60}):\s+(.+)$/.exec(s);
    return lead ? { lead: lead[1]!.trim(), text: lead[2]!.trim() } : { lead: null, text: s };
  });
}

// ── roles ──────────────────────────────────────────────────────────────────────────

/** "Role — Org (dates)" (the keyless draft's form), "Role, Org", "Role at Org" -> parts. */
export function parseRoleTitle(title: string): { role: string; org: string | null; dates: string | null } {
  let rest = title.trim();
  let dates: string | null = null;
  const paren = /\s*\(([^()]*\d{4}[^()]*)\)\s*$/.exec(rest);
  if (paren) {
    dates = paren[1]!.trim();
    rest = rest.slice(0, paren.index).trim();
  } else {
    const d = DATE_RANGE.exec(rest);
    if (d) {
      dates = d[0];
      rest = (rest.slice(0, d.index) + rest.slice(d.index + d[0].length)).trim().replace(/^[:\-–—,\s]+|[:\-–—,\s]+$/g, "");
    }
  }
  const dash = rest.split(/\s+[—–]\s+/);
  if (dash.length >= 2) return { role: dash[0]!.trim(), org: dash.slice(1).join(" — ").trim(), dates };
  const at = /^(.+?)\s+(?:at|@|ve|bei|chez)\s+(.+)$/i.exec(rest);
  if (at) return { role: at[1]!.trim(), org: at[2]!.trim(), dates };
  return { role: rest, org: null, dates };
}

/** Typography only: an en dash between the ends and a two-digit month ("7/2026" ->
 *  "07/2026"). No date is inferred, moved or completed. */
export function formatDates(dates: string | null): string | null {
  if (!dates) return null;
  return dates
    .replace(/(?<!\d)(\d)(?=[./](?:19|20)\d\d)/g, "0$1")
    .replace(/\s*(?:-|–|—|to)\s*(?=(?:\d|present|now|current|dosud|současnost|heute|aujourd))/i, " – ")
    .trim();
}

// ── the document's language ────────────────────────────────────────────────────────
//
// The section headings follow the language the CV is WRITTEN in, not the reader's UI:
// an English CV opened by a seeker whose product runs in Czech must not come out with
// "Pracovní zkušenosti" above English bullets. So the headings are content, detected
// from the text and kept here beside the reading, not in the UI catalogs.

export const CV_LANGS = ["en", "cs", "de", "fr"] as const;
export type CvLang = (typeof CV_LANGS)[number];

const STOPWORDS: Record<CvLang, RegExp> = {
  en: /(?<![\p{L}])(the|and|with|for|of|in|to|using|including)(?![\p{L}])/giu,
  cs: /(?<![\p{L}])(a|v|ve|na|se|pro|s|z|jako|při|který|která)(?![\p{L}])/giu,
  de: /(?<![\p{L}])(und|der|die|das|mit|für|von|im|bei|als)(?![\p{L}])/giu,
  fr: /(?<![\p{L}])(et|le|la|les|des|pour|avec|dans|du|en)(?![\p{L}])/giu,
};

export function cvLanguageOf(text: string): CvLang {
  let best: CvLang = "en";
  let bestN = 0;
  for (const lang of CV_LANGS) {
    const n = (text.match(STOPWORDS[lang]) ?? []).length;
    if (n > bestN) {
      best = lang;
      bestN = n;
    }
  }
  return best;
}

export type CvHeadings = { summary: string; experience: string; skills: string; education: string; languages: string; contact: string };

export const CV_HEADINGS: Record<CvLang, CvHeadings> = {
  en: { summary: "Profile", experience: "Experience", skills: "Skills", education: "Education", languages: "Languages", contact: "Contact" },
  cs: { summary: "Profil", experience: "Pracovní zkušenosti", skills: "Dovednosti", education: "Vzdělání", languages: "Jazyky", contact: "Kontakt" },
  de: { summary: "Profil", experience: "Berufserfahrung", skills: "Kenntnisse", education: "Ausbildung", languages: "Sprachen", contact: "Kontakt" },
  fr: { summary: "Profil", experience: "Expérience", skills: "Compétences", education: "Formation", languages: "Langues", contact: "Contact" },
};

/** The objective line under the headline, in the CV's language: the seeker's STATED
 *  target, labelled as what they are looking for — never worded as a title they held. */
export const CV_OBJECTIVE: Record<CvLang, (target: string) => string> = {
  en: (target) => `Seeking: ${target} roles`,
  cs: (target) => `Hledám pozici: ${target}`,
  de: (target) => `Angestrebte Position: ${target}`,
  fr: (target) => `Poste recherché : ${target}`,
};

/** A stated level as 1-3 pips; the CV's own word stays beside it for a parser and a reader. */
export function levelPips(level: string | null): 0 | 1 | 2 | 3 {
  switch ((level ?? "").toLowerCase()) {
    case "junior":
    case "basic":
    case "beginner":
    case "foundational":
      return 1;
    case "medior":
    case "mid":
    case "intermediate":
    case "working":
      return 2;
    case "senior":
    case "lead":
    case "expert":
    case "advanced":
    case "strong":
    case "native":
    case "fluent":
      return 3;
    default:
      return 0;
  }
}

// ── skills ─────────────────────────────────────────────────────────────────────────

const LEVEL_WORD = /\s*\((junior|medior|mid|senior|lead|expert|advanced|intermediate|basic|beginner|native|fluent)\)\s*$/i;

function skillGroupsFrom(blocks: Block[], log: CvImprovement[]): CvSkillGroup[] {
  const groups: CvSkillGroup[] = [];
  for (const b of blocks) {
    if (b.kind !== "group" && b.kind !== "skills") continue;
    const items = b.lines
      .filter((l) => l && l.length <= 48 && !/[.!?]$/.test(l))
      .flatMap((l) => (b.kind === "skills" && l.includes(",") ? l.split(/\s*,\s*/) : [l]))
      .map((l) => {
        const m = LEVEL_WORD.exec(l);
        const name = polishTerms((m ? l.slice(0, m.index) : l).trim(), log);
        return { name, level: m ? m[1]!.toLowerCase() : null };
      })
      .filter((i) => i.name);
    if (items.length) groups.push({ title: b.kind === "skills" ? null : titleCase(b.title), items });
  }
  return groups;
}

// ── the document ───────────────────────────────────────────────────────────────────

export function buildCvDocument(input: { profile: ProfilePayload; preferences: Pick<JobseekerPreferences, "targetTitles">; cvSourceText: string | null }): CvDocument {
  // `preferences` stays on the input (the callers hold it) but no longer shapes the sheet.
  const { profile } = input;
  const text = input.cvSourceText ?? "";
  const log: CvImprovement[] = [];
  const blocks = blocksOf(text);
  const header = blocks[0]!.lines.filter(Boolean);

  const rawName = profile.displayName?.trim() || header[0] || "";
  const name = isShouting(rawName) ? titleCase(rawName) : rawName;
  // The headline is the CV's own, or none. A target title never stands in for it: set
  // under the name, "AI Engineer" reads as a title the seeker has held. The direction is
  // said by the tailoring's objective line ("Seeking: AI Engineer roles"), labelled as
  // sought (cvTailor.ts).
  const headlineLine = header.find((l) => l !== rawName && l.length <= 60 && !/@|\d{3}|\.(com|cz|io|dev|me)\b|linkedin|github/i.test(l));
  const headline = headlineLine ? polishTerms(isShouting(headlineLine) ? titleCase(headlineLine) : headlineLine, log) : null;

  const summaryBlock = blocks.find((b) => b.kind === "summary");
  const summaryText = summaryBlock ? summaryBlock.lines.filter(Boolean).join(" ").trim() : "";
  const summary = summaryText ? bulletsOf(summaryText, log).map((b) => (b.lead ? `${b.lead}: ${b.text}` : b.text)).join(" ") : null;

  const experience: CvRole[] = (profile.evidence ?? [])
    .filter((e) => (e.kind ?? "job") === "job" && e.title && e.title !== "Summary")
    .map((e) => {
      const parts = parseRoleTitle(e.title ?? "");
      return {
        role: polishTerms(parts.role, log),
        org: parts.org,
        dates: formatDates(parts.dates),
        bullets: bulletsOf(e.text ?? "", log),
      };
    });

  const groups = skillGroupsFrom(blocks, log);
  const skills: CvSkillGroup[] = groups.length
    ? groups
    : (() => {
        // No groups in the CV text: the profile's claims, strongest first, as one group.
        const claims = (profile.skillClaims ?? []).filter((c) => c.skill?.trim());
        const ordered = [...claims.filter((c) => c.level === "strong"), ...claims.filter((c) => c.level !== "strong")];
        const items = ordered.map((c) => {
          const name = polishTerms(c.skill!.trim(), log);
          return { name: name === name.toLowerCase() ? name.charAt(0).toLocaleUpperCase() + name.slice(1) : name, level: null };
        });
        return items.length ? [{ title: null, items }] : [];
      })();

  const eduBlock = blocks.find((b) => b.kind === "education");
  const education: CvEducation[] = eduBlock
    ? [
        {
          title: eduBlock.lines.filter(Boolean)[0] ?? profile.educationDetail ?? "",
          detail: eduBlock.lines.filter(Boolean).slice(1).join(" · ") || null,
          dates: formatDates(eduBlock.dates),
        },
      ].filter((e) => e.title)
    : profile.educationDetail
      ? [{ title: profile.educationDetail, detail: null, dates: null }]
      : [];

  return {
    lang: cvLanguageOf(text),
    name,
    headline,
    location: profile.location?.trim() || null,
    contacts: findContacts(text),
    summary,
    experience,
    skills,
    education,
    languages: (profile.languages ?? []).filter(Boolean),
    improvements: dedupeImprovements(log),
  };
}

function dedupeImprovements(log: CvImprovement[]): CvImprovement[] {
  const seen = new Set<string>();
  return log.filter((i) => {
    const key = `${i.kind}:${i.before}->${i.after}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ── templates and accents (what the picker offers; the look lives in cv.css) ───────

export const CV_TEMPLATES = ["sidebar", "editorial", "compact"] as const;
export type CvTemplate = (typeof CV_TEMPLATES)[number];
export const CV_ACCENTS = ["navy", "moss", "coral", "plum"] as const;
export type CvAccent = (typeof CV_ACCENTS)[number];

export function isCvTemplate(v: unknown): v is CvTemplate {
  return typeof v === "string" && (CV_TEMPLATES as readonly string[]).includes(v);
}
export function isCvAccent(v: unknown): v is CvAccent {
  return typeof v === "string" && (CV_ACCENTS as readonly string[]).includes(v);
}
