// The designed CV TAILORED to the seeker's stated target role — pure, no React, so
// `node --test` holds it (docs/features/jobseeker/README.md, "The designed CV").
//
// A career changer's CV is written in the order they lived it: eight years of analyst,
// QA and frontend work, then the AI consultancy that points at where they are going. A
// reader skimming for an AI Engineer meets the past first. This pass REORDERS and
// EMPHASISES toward the target, and never adds:
//
//   - the summary leads with its most target-relevant sentence (every sentence verbatim);
//   - roles keep their reverse-chronological order (reordering a history reads as hiding
//     it); inside a role the relevant bullets lead, and a term the target asks for is
//     marked for the template to set in bold;
//   - with `compactOffTarget` (the caller's choice, for a CV that runs over one page), a
//     role with nothing relevant in it stays in its place as one line;
//   - skill groups and the items inside them go relevant-first, nothing removed;
//   - the CV's own headline stays; an optional objective line states the seeker's own
//     target, labelled as what they are looking for (CV_OBJECTIVE) — a preference, never a
//     title they held (registry recruiting/skill-adjacency-and-normalization: say only
//     what the record holds).
//
// What the target asks for ("demand") is read from the market when there is one: the
// requirements of the postings the matcher found at this target (`targetAlignment.state
// === "target"`), matched and missing alike, most-asked first. Before any such posting
// exists, a small built-in lexicon per target kind stands in (the kinds mirror
// pipeline/jobfit/target_titles.py ALIAS_GROUPS). Every move is listed as a `tailor`
// improvement, and the coverage — which demanded skills the CV shows, where, and which it
// does not — is for the SEEKER's eyes in the designer, never printed on the sheet.

import type { JobseekerPostingSummary } from "@/app/_lib/jobseeker/types";
import { CV_HEADINGS, CV_OBJECTIVE, polishTerms, splitSentences, type CvBullet, type CvDocument, type CvRole, type CvSkillGroup, type CvTailorMove } from "./cvDocument";

// ── folding and tokens ─────────────────────────────────────────────────────────────

function fold(s: string): string {
  return s.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
}

type Tok = { raw: string; norm: string; start: number; end: number };

// A token keeps a dotted name whole ("Node.js") and a trailing + or # ("C++", "C#"); a
// sentence's final full stop is not part of it.
const TOKEN = /[\p{L}\p{N}]+(?:\.[\p{L}\p{N}]+)*[+#]*/gu;

/** Case- and diacritic-folded, a plain plural "s" dropped on both sides ("LLMs" = "LLM"). */
function normTok(raw: string): string {
  const f = fold(raw);
  return f.length > 3 && f.endsWith("s") && !f.endsWith("ss") ? f.slice(0, -1) : f;
}

function tokensOf(text: string): Tok[] {
  const out: Tok[] = [];
  for (const m of (text || "").matchAll(TOKEN)) out.push({ raw: m[0], norm: normTok(m[0]), start: m.index, end: m.index + m[0].length });
  return out;
}

// Words that are also prose or another language's word ("the rest of", "j'ai", "go to
// market"): they count only written as the acronym. The CV's own text has been through
// polishTerms, which upper-cases the technical ones.
const CASE_SENSITIVE = new Set(["rest", "soap", "qa", "ai", "ml", "go", "it"]);

type Term = { key: string; toks: string[]; label: string; weight: number; skill: boolean };

function termOf(label: string, weight: number, skill: boolean): Term | null {
  const canonical = polishTerms(label.trim(), []);
  const toks = tokensOf(canonical).map((t) => t.norm);
  return toks.length ? { key: toks.join(" "), toks, label: canonical, weight, skill } : null;
}

/** Every [start, end) where `term` occurs in `toks` as a whole-word run. */
function runsOf(toks: Tok[], term: Term): [number, number][] {
  const out: [number, number][] = [];
  const k = term.toks.length;
  for (let i = 0; i + k <= toks.length; i++) {
    let hit = true;
    for (let j = 0; j < k; j++) {
      const tok = toks[i + j]!;
      const want = term.toks[j]!;
      if (tok.norm !== want || (CASE_SENSITIVE.has(want) && tok.raw !== tok.raw.toUpperCase())) {
        hit = false;
        break;
      }
    }
    if (hit) out.push([toks[i]!.start, toks[i + k - 1]!.end]);
  }
  return out;
}

function matchedTerms(text: string, terms: Term[]): Term[] {
  const toks = tokensOf(text);
  return terms.filter((t) => runsOf(toks, t).length > 0);
}

function scoreOf(text: string, terms: Term[]): number {
  return matchedTerms(text, terms).reduce((sum, t) => sum + t.weight, 0);
}

// ── the target's kind (mirrors pipeline/jobfit/target_titles.py) ───────────────────

const SENIORITY = new Set(["senior", "sr", "snr", "junior", "jr", "medior", "mid", "lead", "principal", "staff"]);

// Role nouns name a KIND of job, not its subject: "AI Engineer" is about AI (_ROLE_NOUNS).
const ROLE_NOUNS = new Set([
  "engineer", "developer", "programmer", "analyst", "consultant", "specialist", "manager",
  "architect", "designer", "scientist", "officer", "administrator", "technician", "expert",
  "inzenyr", "vyvojar", "analytik", "konzultant", "specialista",
  "entwickler", "ingenieur", "berater", "developpeur", "analyste",
]);

export const TARGET_KINDS = ["ai", "frontend", "backend", "fullstack", "qa"] as const;
export type TargetKind = (typeof TARGET_KINDS)[number];

// The alias rows are target_titles.py ALIAS_GROUPS verbatim; the lexicon is what postings
// of that kind commonly ask for — used ONLY when the seeker's own market has no posting at
// the target yet, and said so in the designer ("typical for", not "postings ask for").
const KIND_TABLE: Record<TargetKind, { aliases: string[]; lexicon: string[] }> = {
  ai: {
    aliases: ["AI Engineer", "ML Engineer", "LLM Engineer", "Machine Learning Engineer", "GenAI Engineer", "Gen AI Engineer", "Generative AI Engineer", "Applied AI Engineer"],
    lexicon: ["Python", "LLM", "RAG", "LangChain", "Prompt engineering", "Embeddings", "Vector database", "PyTorch", "Machine learning", "NLP", "MLOps", "OpenAI"],
  },
  frontend: {
    aliases: ["Frontend Developer", "Front-end Developer", "Frontend Engineer", "Front-end Engineer", "UI Developer"],
    lexicon: ["JavaScript", "TypeScript", "React", "Next.js", "HTML", "CSS", "Vue.js", "Angular", "Accessibility", "Figma", "REST", "Jest"],
  },
  backend: {
    aliases: ["Backend Developer", "Back-end Developer", "Backend Engineer", "Back-end Engineer"],
    lexicon: ["Java", "Python", "Node.js", "SQL", "PostgreSQL", "REST", "Docker", "Kubernetes", "Microservices", "Kafka", "AWS", "Redis"],
  },
  fullstack: {
    aliases: ["Full-stack Developer", "Fullstack Developer", "Full-stack Engineer", "Fullstack Engineer"],
    lexicon: ["JavaScript", "TypeScript", "React", "Node.js", "SQL", "PostgreSQL", "REST", "Docker", "HTML", "CSS", "AWS", "Git"],
  },
  qa: {
    aliases: ["QA Engineer", "Quality Assurance Engineer", "Test Engineer", "Test Automation Engineer", "Software Tester"],
    lexicon: ["Test automation", "Selenium", "Cypress", "Playwright", "API testing", "Postman", "Jira", "SQL", "CI/CD", "Regression testing", "Python", "Java"],
  },
};

/** A title as target_titles.py compares it: folded, parentheticals and level words gone. */
function titleTokens(title: string): string[] {
  const bare = fold(title).replace(/\([^)]*\)|\[[^\]]*\]/g, " ");
  return (bare.match(/[\p{L}\p{N}]+/gu) ?? []).filter((t) => !SENIORITY.has(t));
}

const sameTokens = (a: string[], b: string[]) => a.length === b.length && a.every((t, i) => t === b[i]);

/** The kind a stated title names, when it IS one of the alias rows (not merely near one). */
export function targetKindOf(title: string): TargetKind | null {
  const own = titleTokens(title);
  if (!own.length) return null;
  for (const kind of TARGET_KINDS) if (KIND_TABLE[kind].aliases.some((a) => sameTokens(titleTokens(a), own))) return kind;
  return null;
}

/** The SUBJECT of a target title and its aliases ("AI Engineer" -> AI, ML, LLM, machine
 *  learning…): target_titles.py `target_phrases`. A CV line that names one speaks to it. */
function subjectPhrases(title: string): string[][] {
  const kind = targetKindOf(title);
  const forms = [titleTokens(title), ...(kind ? KIND_TABLE[kind].aliases.map(titleTokens) : [])];
  const out: string[][] = [];
  for (const form of forms) {
    const subject = form.filter((t) => !ROLE_NOUNS.has(t)).map(normTok);
    if (subject.length && !out.some((o) => sameTokens(o, subject))) out.push(subject);
  }
  return out;
}

// ── demand ─────────────────────────────────────────────────────────────────────────

export type CvDemandSkill = { skill: string; count: number };
/** What the target asks for. `postings` = how many target postings it was read from;
 *  `lexicon` = none yet, the built-in list stands in; `none` = neither exists. */
export type CvDemand = { source: "postings" | "lexicon" | "none"; postings: number; skills: CvDemandSkill[] };
type PostingLike = Pick<JobseekerPostingSummary, "targetAlignment" | "matchedSkills" | "missingSkills">;

/** How many demanded skills tailoring and coverage read: the most-asked, enough to be the
 *  market's picture of the role, few enough that a coverage line stays readable. */
export const DEMAND_CAP = 20;

function isAtTarget(p: PostingLike, target: string): boolean {
  const ta = p.targetAlignment;
  if (!ta || ta.state !== "target") return false;
  // matchedTitle is the seeker's own wording; a dump that dropped it reads like null.
  return !ta.matchedTitle || sameTokens(titleTokens(ta.matchedTitle), titleTokens(target));
}

/** The union of the requirements (met and missing) of the postings at `target`, counted
 *  once per posting, most-asked first. Order-independent: the /me preview and the server
 *  print page read the same rows in different orders and must build the same sheet. */
export function demandFor(target: string, postings: readonly PostingLike[] | null | undefined): CvDemand {
  const at = (postings ?? []).filter((p) => isAtTarget(p, target));
  if (at.length) {
    const byKey = new Map<string, { count: number; labels: Map<string, number> }>();
    for (const p of at) {
      const seen = new Set<string>();
      for (const raw of [...(p.matchedSkills ?? []).map((s) => s.skill), ...(p.missingSkills ?? [])]) {
        const term = typeof raw === "string" ? termOf(raw, 1, true) : null;
        if (!term || seen.has(term.key)) continue;
        seen.add(term.key);
        const entry = byKey.get(term.key) ?? { count: 0, labels: new Map<string, number>() };
        entry.count += 1;
        entry.labels.set(term.label, (entry.labels.get(term.label) ?? 0) + 1);
        byKey.set(term.key, entry);
      }
    }
    const skills = [...byKey.entries()]
      .map(([key, e]) => {
        // The spelling most postings used; a tie goes to the code-point-smaller one.
        const label = [...e.labels.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))[0]![0];
        return { key, skill: label, count: e.count };
      })
      .sort((a, b) => b.count - a.count || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
      .slice(0, DEMAND_CAP)
      .map(({ skill, count }) => ({ skill, count }));
    if (skills.length) return { source: "postings", postings: at.length, skills };
  }
  const kind = targetKindOf(target);
  if (!kind) return { source: "none", postings: at.length, skills: [] };
  return { source: "lexicon", postings: at.length, skills: KIND_TABLE[kind].lexicon.map((skill) => ({ skill, count: 0 })) };
}

/** A target the designer offers, with its demand. `tailor=<index>` indexes THIS list, so
 *  the /me preview and the print page both build it here from the same titles. */
export type CvTailorTarget = { title: string; demand: CvDemand };

export function tailorTargetsOf(targetTitles: readonly string[], postings: readonly PostingLike[] | null | undefined): CvTailorTarget[] {
  return targetTitles.map((t) => t.trim()).filter(Boolean).map((title) => ({ title, demand: demandFor(title, postings) }));
}

// ── the pass ───────────────────────────────────────────────────────────────────────

export type CvTailorOptions = {
  /** Set a role with nothing target-relevant in it as one line (it stays, in its place).
   *  For a CV that runs over one page; never applied when it would leave no full role. */
  compactOffTarget?: boolean;
  /** The "Seeking: <target> roles" line under the headline (default on). */
  objective?: boolean;
};
export type CvCoverageWhere = { kind: "skills" } | { kind: "summary" } | { kind: "role"; role: string };
export type CvCoverage = {
  target: string;
  source: CvDemand["source"];
  postings: number;
  shown: { skill: string; count: number; where: CvCoverageWhere[] }[];
  missing: { skill: string; count: number }[];
};
export type TailoredCv = {
  doc: CvDocument;
  moves: CvTailorMove[];
  coverage: CvCoverage;
  /** Roles with bullets and nothing relevant in them: what `compactOffTarget` would fold. */
  offTargetRoles: number;
};

const EMPHASIS_PER_BULLET = 2;

function short(s: string): string {
  const one = s.replace(/\s+/g, " ").trim();
  if (one.length <= 64) return one;
  // Cut at a word edge, so a quoted bullet never ends mid-word ("business o…").
  const cut = one.slice(0, 61);
  const edge = cut.lastIndexOf(" ");
  return `${(edge > 40 ? cut.slice(0, edge) : cut).replace(/[\s,;:]+$/, "")}…`;
}

const bulletText = (b: CvBullet) => (b.lead ? `${b.lead}: ${b.text}` : b.text);

/** Stable: equal scores keep the CV's own order. */
function byScore<T>(items: T[], score: (t: T) => number): T[] {
  return items
    .map((item, i) => ({ item, i, s: score(item) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.item);
}

/** Up to EMPHASIS_PER_BULLET non-overlapping skill terms in `text`, heaviest first. */
function emphasisIn(text: string, skills: Term[]): [number, number][] {
  const toks = tokensOf(text);
  const picked: [number, number][] = [];
  const used = new Set<string>();
  for (const term of [...skills].sort((a, b) => b.weight - a.weight || b.toks.length - a.toks.length)) {
    if (picked.length >= EMPHASIS_PER_BULLET || used.has(term.key)) continue;
    const run = runsOf(toks, term).find(([s, e]) => !picked.some(([ps, pe]) => s < pe && e > ps));
    if (!run) continue;
    picked.push(run);
    used.add(term.key);
  }
  return picked.sort((a, b) => a[0] - b[0]);
}

export function tailorCvDocument(
  doc: CvDocument,
  input: { target: string; postings?: readonly PostingLike[] | null; demand?: CvDemand; options?: CvTailorOptions }
): TailoredCv {
  const target = input.target.trim();
  const demand = input.demand ?? demandFor(target, input.postings);
  const options = input.options ?? {};
  const heading = CV_HEADINGS[doc.lang].skills;

  // Weights: a skill the market asks for weighs by how often (1 = the most asked); the
  // target's own subject ("AI" for AI Engineer) weighs as much as the top skill.
  const maxCount = Math.max(1, ...demand.skills.map((s) => s.count));
  const skillTerms: Term[] = [];
  for (const s of demand.skills) {
    const term = termOf(s.skill, demand.source === "postings" ? Math.max(0.2, s.count / maxCount) : 1, true);
    if (term && !skillTerms.some((t) => t.key === term.key)) skillTerms.push(term);
  }
  const terms: Term[] = [...skillTerms];
  for (const toks of subjectPhrases(target)) {
    const key = toks.join(" ");
    const existing = terms.find((t) => t.key === key);
    if (existing) existing.weight = Math.max(existing.weight, 1);
    else terms.push({ key, toks, label: key, weight: 1, skill: false });
  }

  const moves: CvTailorMove[] = [];
  const move = (m: Omit<CvTailorMove, "kind" | "n"> & { n?: number }) => moves.push({ kind: "tailor", n: 0, ...m });
  let emphasised = 0;

  // Summary: the most relevant sentence leads; the rest keep their order, every one verbatim.
  let summary = doc.summary;
  if (summary) {
    const sentences = splitSentences(summary);
    const scores = sentences.map((s) => scoreOf(s, terms));
    const best = scores.reduce((bi, s, i) => (s > scores[bi]! ? i : bi), 0);
    if (best > 0 && scores[best]! > 0) {
      summary = [sentences[best]!, ...sentences.filter((_, i) => i !== best)].join(" ");
      move({ move: "summary", before: short(sentences[0]!), after: short(sentences[best]!), where: null });
    }
  }

  // Experience: the roles' order is the CV's (reverse-chronological); inside each, the
  // relevant bullets lead and a demanded term is marked.
  const relevance = new Map<CvRole, number>();
  const roles: CvRole[] = doc.experience.map((r) => {
    const ordered = byScore(r.bullets, (b) => scoreOf(bulletText(b), terms));
    if (ordered.length && ordered[0] !== r.bullets[0]) {
      move({ move: "bullets", before: short(bulletText(r.bullets[0]!)), after: short(ordered[0]!.lead ?? ordered[0]!.text), where: r.role });
    }
    const bullets = ordered.map((b) => {
      const marks = emphasisIn(b.text, skillTerms);
      emphasised += marks.length;
      return marks.length ? { ...b, emphasis: marks } : { ...b };
    });
    const role = { ...r, bullets };
    relevance.set(role, Math.max(scoreOf(r.role, terms), ...r.bullets.map((b) => scoreOf(bulletText(b), terms))));
    return role;
  });
  const offTarget = roles.filter((r) => r.bullets.length > 0 && !relevance.get(r));
  const fullOnTarget = roles.some((r) => r.bullets.length > 0 && relevance.get(r)! > 0);
  if (options.compactOffTarget && fullOnTarget) {
    for (const r of offTarget) {
      r.compact = true;
      move({ move: "compact", before: "", after: r.role, where: r.role });
    }
  }

  // Skills: groups and the items inside them relevant-first; nothing removed.
  const itemScore = (name: string) => scoreOf(name, terms);
  const groupScore = (g: CvSkillGroup) => matchedTerms([g.title ?? "", ...g.items.map((i) => i.name)].join(" · "), terms).reduce((s, t) => s + t.weight, 0);
  const orderedGroups = byScore(doc.skills, groupScore);
  if (orderedGroups.length && orderedGroups[0] !== doc.skills[0]) {
    move({ move: "groups", before: doc.skills[0]!.title ?? heading, after: orderedGroups[0]!.title ?? heading, where: null });
  }
  const groups = orderedGroups.map((g) => {
    const items = byScore(g.items, (i) => itemScore(i.name)).map((i) => {
      const hit = matchedTerms(i.name, skillTerms).length > 0;
      if (hit) emphasised += 1;
      return hit ? { ...i, emphasis: true } : { ...i };
    });
    if (items.length && items[0]!.name !== g.items[0]!.name) {
      const lead = items.filter((i) => itemScore(i.name) > 0).slice(0, 3).map((i) => i.name);
      move({ move: "items", before: g.items[0]!.name, after: lead.join(", "), where: g.title ?? heading });
    }
    return { ...g, items };
  });
  if (emphasised) move({ move: "emphasis", before: "", after: "", where: null, n: emphasised });

  // The objective: the seeker's stated target, in the CV's language — skipped when the
  // CV's own headline already says it.
  let objective: string | null = null;
  const own = titleTokens(target);
  const headlineSaysIt = !!doc.headline && own.length > 0 && titleTokens(doc.headline).join(" ").includes(own.join(" "));
  if (options.objective !== false && target && !headlineSaysIt) {
    objective = CV_OBJECTIVE[doc.lang](target);
    move({ move: "objective", before: "", after: objective, where: null });
  }

  // Coverage, read from the CV as it is (order does not change what it shows).
  const shown: CvCoverage["shown"] = [];
  const missing: CvCoverage["missing"] = [];
  for (const s of demand.skills) {
    const term = termOf(s.skill, 1, true);
    if (!term) continue;
    const where: CvCoverageWhere[] = [];
    const has = (text: string) => runsOf(tokensOf(text), term).length > 0;
    if (doc.skills.some((g) => g.items.some((i) => has(i.name)))) where.push({ kind: "skills" });
    if (doc.summary && has(doc.summary)) where.push({ kind: "summary" });
    for (const r of doc.experience) if (has(r.role) || r.bullets.some((b) => has(bulletText(b)))) where.push({ kind: "role", role: r.role });
    if (where.length) shown.push({ skill: s.skill, count: s.count, where });
    else missing.push({ skill: s.skill, count: s.count });
  }

  return {
    doc: { ...doc, summary, objective, experience: roles, skills: groups, improvements: [...doc.improvements, ...moves] },
    moves,
    coverage: { target, source: demand.source, postings: demand.postings, shown, missing },
    offTargetRoles: fullOnTarget ? offTarget.length : 0,
  };
}
