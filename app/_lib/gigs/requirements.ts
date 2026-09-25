import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import path from "node:path";
import { listGigBriefsForArena, type GigArenaBrief } from "../db/gigs";
import { gigChecklist } from "./checklists";
import {
  GIG_CLIENT_FILES_DIR,
  GIG_CONTRACT_FILE,
  GIG_DELIVERABLE_FILE,
  GIG_PROCESS_LOG_FILE,
  GIG_RUN_CONSTRAINTS,
} from "./contract";
import type { ResolvedGigRecipe, ResolvedGigRecipes } from "./recipes";
import { GIG_BRIEF_HEADINGS } from "./research";
import { GIG_ARENA_TOOLS, gigSpecialistName } from "./specialist-defaults";
import { scanGigForHoneypots } from "./suspect";
import { GIG_DELIVERABLE_CONTRACT, type GigArena, type GigAssignment, type GigBrief, type GigSpecialistSpec } from "./types";

// What a gig specialist is hired FROM: a structured requirements object
// (`kp.agent-requirements.v1`), never a system prompt kp wrote.
//
// Operator decision (2026-09-25): "KP should not create prompts, KP should extract
// requirements for agent based on research. Personas should create agent in alignment with
// its design to execute it, so we are able to overview and manage in the app." So kp states
// WHAT the agent is for and WHAT it must honour - the craft of its adopted recipes (with the
// newest lessons those recipes earned), what kp's research of real listings in the arena
// found, the assignment it will receive, the files it must leave, the rules, the tools and
// why each - and Personas designs the agent from that. The wire contract is
// `spec.requirements` on POST /api/kp/persona-requests (docs/features/gigs/README.md).
//
// Where each part comes from - ONE source each, never a retyped copy:
//   role, arena, niche, budget  the specialist spec (specialist.ts compose)
//   purpose, responsibilities,  the adopted recipes as recipes.ts resolved them (registry
//   craft                       checkout, else the built-in seed)
//   craft[].lessons             the newest bullets of each registry recipe's LESSONS.md
//   research                    the research BRIEFS of this workspace's gigs in the arena
//                               (niche-scoped when the niche matches any), aggregated here
//   inputs                      GIG_ASSIGNMENT_FIELDS below, typed against GigAssignment
//   outputs, constraints        contract.ts - the same constants the gig folder's
//                               DELIVERABLE-CONTRACT.md is rendered from -
//                               and checklists.ts for the review checklist
//   tools                       GIG_ARENA_TOOLS (specialist-defaults.ts)
//
// Deterministic, keyless, no model. The only IO is reading LESSONS.md (bounded, read-only)
// and one store read for the research; both are injectable, and every aggregate below is a
// pure function of its rows.
//
// UNTRUSTED TEXT. A brief is a model's reading of a listing a stranger wrote, so the
// research strings (categories, asks, challenges) are derived from untrusted text. They
// travel as DATA inside a structured field, and every candidate string is run through the
// deterministic honeypot scan first (suspect.ts): one that reads like an instruction to an
// agent is dropped, never forwarded. Gigs the scan held back are not read at all
// (listGigBriefsForArena).

export const GIG_REQUIREMENTS_KIND = "kp.agent-requirements.v1" as const;

/** Stored as the specialist spec's `promptVersion` (the field keeps its name: it is
 *  persisted in every gig_specialists row). v1 (2026-09-25): requirements replace the
 *  kp-written system prompt, which ended at `gig-specialist.v3`. */
export const GIG_REQUIREMENTS_VERSION = "gig-requirements.v1";

/** Personas' intake bounds (the wire contract): the serialized object, each array, each string. */
export const GIG_REQUIREMENTS_MAX_BYTES = 32 * 1024;
export const GIG_REQUIREMENTS_MAX_ITEMS = 30;
export const GIG_REQUIREMENTS_MAX_CHARS = 1000;
/** kp stays under Personas' byte ceiling by this margin (the request carries more than this object). */
const BYTES_TARGET = GIG_REQUIREMENTS_MAX_BYTES - 2 * 1024;

/** Lessons carried per recipe, newest first, and each one's length. */
export const GIG_LESSONS_PER_RECIPE = 5;
export const GIG_LESSON_MAX_CHARS = 500;
/** LESSONS.md is append-only (newest last): only its tail is read. */
export const GIG_LESSONS_READ_MAX_BYTES = 64 * 1024;

/** Items per research list. */
export const GIG_RESEARCH_TOP = 8;

export type GigRequirementsCraft = {
  /** `<slug>@<version>`. */
  recipe: string;
  title: string;
  need: string;
  /** Absent for a seed-resolved recipe (the seed carries a need only). */
  coreAction?: string;
  successCriteria: string[];
  /** The newest generalizable LESSONS.md bullets, newest first; [] for a seed recipe. */
  lessons: string[];
};

export type GigRequirementsResearch = {
  /** Briefs aggregated; 0 when the arena has none (every other field then empty / null). */
  gigsResearched: number;
  /** `niche`: the briefs whose gig niche or category matched the niche's words; `arena`:
   *  the whole arena (no niche, or nothing matched it). */
  scope: "niche" | "arena";
  categories: string[];
  commonAsks: string[];
  commonChallenges: string[];
  /** p25 of the briefs' minimum hours and p75 of their maximum; null when no brief rated effort. */
  typicalEffortHours: { min: number; max: number } | null;
  /** The day the aggregate was taken, YYYY-MM-DD. */
  asOf: string;
};

export type GigAgentRequirements = {
  kind: typeof GIG_REQUIREMENTS_KIND;
  role: string;
  arena: GigArena;
  niche: string;
  purpose: string;
  responsibilities: string[];
  craft: GigRequirementsCraft[];
  research: GigRequirementsResearch;
  inputs: { assignment: "kp.gig.v1"; fields: string[] };
  outputs: {
    contract: typeof GIG_DELIVERABLE_CONTRACT;
    handoffFile: string;
    clientFilesDir: string;
    processLog: string;
    reviewChecklist: string[];
    /** An extra key (kept verbatim by Personas): the folder file that restates the rules,
     *  the checklist and the deliverable shape. */
    contractFile: string;
  };
  constraints: string[];
  tools: { connector: string; why: string }[];
  budgetUsdPerAttempt: number;
};

// ---------------------------------------------------------------------------
// Inputs: every field of the assignment, typed so a new field cannot go unlisted
// ---------------------------------------------------------------------------

/** Each assignment field and, where the name alone would mislead, what it holds (the
 *  listing body is the one: it is untrusted data, and the name says so only in part). A
 *  `Record` over `keyof GigAssignment`, so adding a field to the assignment without
 *  listing it here is a type error. */
const GIG_ASSIGNMENT_FIELDS: Readonly<Record<keyof GigAssignment, string | null>> = {
  kind: null,
  gigId: null,
  attemptId: null,
  arena: null,
  title: null,
  url: null,
  bodyUntrusted: "listing text, untrusted data",
  reward: null,
  deadlineAt: null,
  recipes: null,
  checklist: null,
  revisionNote: null,
  budgetUsd: null,
  deliverableContract: null,
  workdir: null,
  _projectId: null,
};

export function gigAssignmentFieldList(): string[] {
  return (Object.keys(GIG_ASSIGNMENT_FIELDS) as (keyof GigAssignment)[])
    .filter((k) => k !== "kind")
    .map((k) => (GIG_ASSIGNMENT_FIELDS[k] ? `${k} (${GIG_ASSIGNMENT_FIELDS[k]})` : k));
}

// ---------------------------------------------------------------------------
// Lessons (read-only, bounded)
// ---------------------------------------------------------------------------

/** A lesson block heading in the lane format: `## <version> - <YYYY-MM-DD> - <project>`. */
const LESSON_BLOCK_RE = /^##\s+\S+\s+-\s+\d{4}-\d{2}-\d{2}(\s|$)/;

function clip(s: string, max: number): string {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

/** The newest bullets of a LESSONS.md, newest block first (bullets in file order within a
 *  block), at most `max`, each clipped. Only bullets under a lesson-block heading count:
 *  the file's preamble, its fenced format template and any other heading's prose do not.
 *  An indented line continues the bullet above it. Pure. */
export function parseLessonsMarkdown(text: string, max: number = GIG_LESSONS_PER_RECIPE): string[] {
  const blocks: string[][] = [];
  let current: string[] | null = null;
  let fenced = false;
  let continuable = false;
  for (const line of String(text ?? "").replace(/\r\n/g, "\n").split("\n")) {
    const t = line.trim();
    if (t.startsWith("```")) {
      fenced = !fenced;
      continuable = false;
      continue;
    }
    if (fenced) continue;
    if (/^#{1,6}\s/.test(t)) {
      current = LESSON_BLOCK_RE.test(t) ? [] : null;
      if (current) blocks.push(current);
      continuable = false;
      continue;
    }
    if (!current) continue;
    const bullet = /^\s{0,3}[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      if (bullet[1]!.trim()) current.push(bullet[1]!.trim());
      continuable = !!bullet[1]!.trim();
    } else if (t && continuable && /^\s/.test(line)) {
      current[current.length - 1] = `${current[current.length - 1]} ${t}`;
    } else {
      continuable = false;
    }
  }
  const out: string[] = [];
  for (let i = blocks.length - 1; i >= 0 && out.length < max; i--) {
    for (const b of blocks[i]!) {
      if (out.length >= max) break;
      const c = clip(b, GIG_LESSON_MAX_CHARS);
      if (c) out.push(c);
    }
  }
  return out;
}

/** The tail of a file, at most `maxBytes`, as UTF-8 (a cut first line is dropped). Null
 *  when it cannot be read. */
function readTail(file: string, maxBytes: number): string | null {
  let fd: number | null = null;
  try {
    fd = openSync(file, "r");
    const size = fstatSync(fd).size;
    const len = Math.min(size, maxBytes);
    const buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, size - len);
    const text = buf.toString("utf8");
    return len < size ? text.slice(text.indexOf("\n") + 1) : text;
  } catch {
    // No LESSONS.md (or unreadable): the recipe simply has no lessons to carry.
    return null;
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {
        /* best-effort: a descriptor that fails to close was only ever read */
      }
    }
  }
}

/** Each adopted recipe's newest lessons, by slug. Only a registry-resolved recipe has a
 *  folder, and so a LESSONS.md; a seed recipe has none ([]). Read-only. */
export function readGigRecipeLessons(
  recipes: readonly Pick<ResolvedGigRecipe, "ref" | "origin" | "folder">[],
  max: number = GIG_LESSONS_PER_RECIPE
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const r of recipes) {
    const text = r.origin === "registry" && r.folder ? readTail(path.join(r.folder, "LESSONS.md"), GIG_LESSONS_READ_MAX_BYTES) : null;
    out[r.ref.slug] = text ? parseLessonsMarkdown(text, max) : [];
  }
  return out;
}

// ---------------------------------------------------------------------------
// Research: aggregate the arena's briefs (pure)
// ---------------------------------------------------------------------------

const STOPWORDS = new Set(["a", "an", "and", "or", "the", "of", "for", "to", "in", "on", "with", "by", "at", "is", "be"]);

function words(text: string): string[] {
  return String(text ?? "")
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/** The niche's matching words: folded, stop words and "general" dropped. [] = no niche. */
export function nicheTokens(niche: string | null | undefined): string[] {
  return [...new Set(words(niche ?? "").filter((w) => w.length >= 2 && !STOPWORDS.has(w) && w !== "general"))];
}

/** A brief belongs to the niche when EVERY niche word starts a word of the gig's niche or
 *  of the brief's category ("web development" matches "Web development · Landing page",
 *  not "Mobile development · ..." nor "Web security · ..."). */
export function briefMatchesNiche(row: Pick<GigArenaBrief, "niche" | "brief">, tokens: readonly string[]): boolean {
  if (tokens.length === 0) return false;
  const hay = words(`${row.niche ?? ""} ${row.brief.category ?? ""}`);
  return tokens.every((t) => hay.some((w) => w.startsWith(t)));
}

/** A phrase's counting key: folded, punctuation and stop words gone, spaces collapsed. */
export function phraseKey(s: string): string {
  return words(s)
    .filter((w) => !STOPWORDS.has(w))
    .join(" ");
}

/** Brief text that reads like an instruction to an agent is not forwarded. */
function looksInjected(s: string): boolean {
  return scanGigForHoneypots({ bodyText: s, bodyHtml: null, title: "" }).length > 0;
}

/** The most frequent phrases across the lists (each counted once per list), most frequent
 *  first; each shown in the wording of its first occurrence. Ties go by the phrase's place
 *  in its list, then by the list's: with few repeats (the usual case - a model words every
 *  brief differently) that takes each brief's LEADING phrase before anyone's second, so the
 *  top of the list spreads across gigs instead of being the newest brief's list verbatim. */
export function topPhrases(lists: readonly (readonly string[])[], max: number = GIG_RESEARCH_TOP): string[] {
  const seen = new Map<string, { count: number; pos: number; list: number; text: string }>();
  lists.forEach((items, listIndex) => {
    const inList = new Set<string>();
    for (const raw of items) {
      if (typeof raw !== "string") continue;
      const text = clip(raw, 240);
      const key = phraseKey(text);
      if (!key || inList.has(key) || looksInjected(text)) continue;
      const pos = inList.size;
      inList.add(key);
      const hit = seen.get(key);
      if (hit) hit.count += 1;
      else seen.set(key, { count: 1, pos, list: listIndex, text });
    }
  });
  return [...seen.values()]
    .sort((a, b) => b.count - a.count || a.pos - b.pos || a.list - b.list)
    .slice(0, max)
    .map((e) => e.text);
}

/** Linear-interpolated percentile of an ascending list (p in 0..1). */
function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 1) return sorted[0]!;
  const at = (sorted.length - 1) * p;
  const lo = Math.floor(at);
  const hi = Math.ceil(at);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (at - lo);
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** The bullets under the brief's "What it asks for" heading (research.ts writes them
 *  escaped, one per ask); [] for a brief without that section (the deterministic one). */
export function briefAsks(markdown: string): string[] {
  const out: string[] = [];
  let inAsks = false;
  for (const line of String(markdown ?? "").replace(/\r\n/g, "\n").split("\n")) {
    const h = /^#{1,6}\s+(.*)$/.exec(line.trim());
    if (h) {
      inAsks = h[1]!.trim() === GIG_BRIEF_HEADINGS.asks;
      continue;
    }
    if (!inAsks) continue;
    const b = /^-\s+(.*)$/.exec(line.trim());
    if (b) out.push(b[1]!.replace(/\\([\\*`<#[\].-])/g, "$1").trim());
  }
  return out.filter(Boolean);
}

function validEffort(e: GigBrief["effort"]): { minHours: number; maxHours: number } | null {
  if (!e || typeof e !== "object") return null;
  const { minHours, maxHours } = e;
  return typeof minHours === "number" && typeof maxHours === "number" && Number.isFinite(minHours) && Number.isFinite(maxHours) && minHours > 0 && maxHours >= minHours
    ? { minHours, maxHours }
    : null;
}

/** YYYY-MM-DD of a clock reading. */
export function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** What kp's research of the arena's listings found, for one niche. Pure: the rows and the
 *  day are the whole input. */
export function aggregateGigResearch(rows: readonly GigArenaBrief[], niche: string | null | undefined, asOf: string): GigRequirementsResearch {
  const tokens = nicheTokens(niche);
  const inNiche = tokens.length > 0 ? rows.filter((r) => briefMatchesNiche(r, tokens)) : [];
  const scope: GigRequirementsResearch["scope"] = inNiche.length > 0 ? "niche" : "arena";
  const set = scope === "niche" ? inNiche : rows;
  const efforts = set.map((r) => validEffort(r.brief.effort)).filter((e): e is { minHours: number; maxHours: number } => e !== null);
  const mins = efforts.map((e) => e.minHours).sort((a, b) => a - b);
  const maxes = efforts.map((e) => e.maxHours).sort((a, b) => a - b);
  return {
    gigsResearched: set.length,
    scope,
    categories: topPhrases(set.map((r) => (typeof r.brief.category === "string" ? [r.brief.category] : []))),
    commonAsks: topPhrases(set.map((r) => briefAsks(r.brief.markdown))),
    commonChallenges: topPhrases(set.map((r) => (Array.isArray(r.brief.challenges) ? r.brief.challenges : []))),
    typicalEffortHours: efforts.length > 0 ? { min: round1(percentile(mins, 0.25)), max: round1(percentile(maxes, 0.75)) } : null,
    asOf,
  };
}

/** The research for a specialist about to be hired: this workspace's briefs in the arena,
 *  aggregated. The store read is injectable for tests. */
export function gatherGigResearch(
  workspaceId: string,
  arena: GigArena,
  niche: string | null | undefined,
  deps: { now?: () => Date; listBriefs?: typeof listGigBriefsForArena } = {}
): GigRequirementsResearch {
  const rows = (deps.listBriefs ?? listGigBriefsForArena)(workspaceId, arena);
  return aggregateGigResearch(rows, niche, isoDay((deps.now ?? (() => new Date()))()));
}

// ---------------------------------------------------------------------------
// Composition (pure given the lessons) and the byte budget
// ---------------------------------------------------------------------------

/** Trimmed, one line, at most GIG_REQUIREMENTS_MAX_CHARS. */
function field(s: string | null | undefined): string {
  return clip(String(s ?? ""), GIG_REQUIREMENTS_MAX_CHARS);
}

function list(items: readonly (string | null | undefined)[], max: number = GIG_REQUIREMENTS_MAX_ITEMS): string[] {
  const out: string[] = [];
  for (const i of items) {
    const v = field(i);
    if (v && !out.includes(v)) out.push(v);
    if (out.length >= Math.min(max, GIG_REQUIREMENTS_MAX_ITEMS)) break;
  }
  return out;
}

/** How much of the long lists a composition keeps; shrunk step by step until it fits. */
type Caps = { criteria: number; lessons: number; research: number };
const CAP_STEPS: readonly Caps[] = [
  { criteria: GIG_REQUIREMENTS_MAX_ITEMS, lessons: GIG_LESSONS_PER_RECIPE, research: GIG_RESEARCH_TOP },
  { criteria: 6, lessons: 3, research: 6 },
  { criteria: 3, lessons: 2, research: 4 },
  { criteria: 1, lessons: 1, research: 2 },
  { criteria: 0, lessons: 0, research: 0 },
];

export function requirementsBytes(r: GigAgentRequirements): number {
  return Buffer.byteLength(JSON.stringify(r), "utf8");
}

export type ComposeGigRequirementsOptions = {
  /** Lessons by slug; read from each registry recipe's LESSONS.md when omitted. */
  lessons?: Record<string, readonly string[]>;
};

/** The `kp.agent-requirements.v1` object a gig specialist is hired from. Every string is
 *  trimmed and bounded, every list capped, and the whole stays under Personas' byte
 *  ceiling (the long lists shrink first; the rules, outputs and tools never do). */
export function composeGigRequirements(
  spec: GigSpecialistSpec,
  resolved: Pick<ResolvedGigRecipes, "recipes">,
  research: GigRequirementsResearch,
  opts: ComposeGigRequirementsOptions = {}
): GigAgentRequirements {
  const recipes = resolved.recipes;
  const lessons = opts.lessons ?? readGigRecipeLessons(recipes);
  const arenaRecipe = recipes[0];
  const whyByConnector = new Map(GIG_ARENA_TOOLS[spec.arena].map((t) => [t.connector, t.why]));
  const build = (caps: Caps): GigAgentRequirements => ({
    kind: GIG_REQUIREMENTS_KIND,
    role: field(gigSpecialistName(spec)),
    arena: spec.arena,
    niche: field(spec.niche),
    purpose: field(arenaRecipe?.need) || field(`Draft ${spec.arena} work for the operator to review and send.`),
    responsibilities: list(recipes.flatMap((r) => (r.activities.length > 0 ? r.activities : r.coreAction ? [r.coreAction] : []))),
    craft: recipes.slice(0, GIG_REQUIREMENTS_MAX_ITEMS).map((r) => ({
      recipe: field(`${r.ref.slug}@${r.ref.version}`),
      title: field(r.title),
      need: field(r.need),
      ...(r.coreAction ? { coreAction: field(r.coreAction) } : {}),
      successCriteria: list(r.successCriteria, caps.criteria),
      lessons: list(lessons[r.ref.slug] ?? [], caps.lessons),
    })),
    research: {
      gigsResearched: research.gigsResearched,
      scope: research.scope,
      categories: list(research.categories, caps.research),
      commonAsks: list(research.commonAsks, caps.research),
      commonChallenges: list(research.commonChallenges, caps.research),
      typicalEffortHours: research.typicalEffortHours ? { ...research.typicalEffortHours } : null,
      asOf: field(research.asOf),
    },
    inputs: { assignment: "kp.gig.v1", fields: list(gigAssignmentFieldList()) },
    outputs: {
      contract: GIG_DELIVERABLE_CONTRACT,
      handoffFile: GIG_DELIVERABLE_FILE,
      clientFilesDir: `${GIG_CLIENT_FILES_DIR}/`,
      processLog: GIG_PROCESS_LOG_FILE,
      reviewChecklist: list(gigChecklist(spec.arena)),
      contractFile: GIG_CONTRACT_FILE,
    },
    constraints: list(GIG_RUN_CONSTRAINTS),
    tools: spec.connectors.slice(0, GIG_REQUIREMENTS_MAX_ITEMS).map((c) => ({
      connector: field(c),
      why: field(whyByConnector.get(c) ?? "requested for this specialist at hire time"),
    })),
    budgetUsdPerAttempt: spec.budgetUsdPerAttempt,
  });
  let out = build(CAP_STEPS[0]!);
  for (const caps of CAP_STEPS.slice(1)) {
    if (requirementsBytes(out) <= BYTES_TARGET) break;
    out = build(caps);
  }
  return out;
}
