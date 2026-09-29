import type { Gig, GigArena, GigBrief } from "./types";

// The KIND of work a gig is (gig-mastery S2, docs/features/gigs/README.md "Pairing"): a
// closed vocabulary orthogonal to the arena. The arena says where the work came from (a
// bounty program, a freelance board); the type says what the work IS, and it decides three
// things - the gig's folder (`<root>/<type>/...`, workdir.ts), the Personas workspace its
// persona and project are filed in ("Gigs · Security", project.ts), and the registry
// KNOWLEDGE its persona is hired with (GIG_TYPE_KNOWLEDGE below).
//
// Deterministic and keyless: the brief's category (its first segment, "Web security" in
// "Web security · Stored XSS") is matched against keyword rules, then the arena decides.
// Multi-word phrases outrank single words ("System design" is architecture, not ui), and
// among single words the rule order below wins ("Web security" is security, "Web design"
// is web). Pure apart from `resolveGigTypeKnowledge`, which reads the registry index.

export const GIG_TYPES = ["security", "web", "ui", "data-ml", "architecture", "content", "other"] as const;
export type GigType = (typeof GIG_TYPES)[number];
export function isGigType(v: unknown): v is GigType {
  return typeof v === "string" && (GIG_TYPES as readonly string[]).includes(v);
}

/** The label a type is shown and filed under (the Personas workspace is `Gigs · <label>`). */
export const GIG_TYPE_LABEL: Readonly<Record<GigType, string>> = {
  security: "Security",
  web: "Web",
  ui: "UI & design",
  "data-ml": "Data & ML",
  architecture: "Architecture",
  content: "Content",
  other: "Other",
};

type Rule = { type: Exclude<GigType, "other">; phrases: readonly string[]; words: readonly string[]; prefixes: readonly string[] };

/** In priority order (security first). `words` match whole words, `prefixes` the start of a
 *  word ("vuln" -> "vulnerability"), `phrases` a run of whole words. */
const RULES: readonly Rule[] = [
  { type: "security", phrases: ["bug bounty"], words: ["security", "xss", "csrf", "sqli", "cve", "infosec", "appsec"], prefixes: ["vuln", "pentest", "exploit"] },
  { type: "web", phrases: ["full stack", "front end", "back end", "web app"], words: ["web", "api", "apis", "backend", "frontend", "fullstack", "website", "websites", "webapp"], prefixes: [] },
  { type: "ui", phrases: [], words: ["ui", "ux", "design", "figma"], prefixes: [] },
  { type: "data-ml", phrases: ["machine learning", "deep learning"], words: ["ml", "data", "ai", "model", "models", "kaggle", "analytics", "llm", "nlp"], prefixes: [] },
  { type: "architecture", phrases: ["system design", "software architecture"], words: ["architecture", "infra", "infrastructure", "devops", "cloud"], prefixes: [] },
  { type: "content", phrases: [], words: ["writing", "content", "copy", "copywriting", "translation", "blog", "article", "articles"], prefixes: [] },
];

function tokens(text: string): string[] {
  return text
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[-_/]+/g, " ")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function hasPhrase(toks: readonly string[], phrase: string): boolean {
  const want = phrase.split(" ");
  for (let i = 0; i + want.length <= toks.length; i++) {
    if (want.every((w, j) => toks[i + j] === w)) return true;
  }
  return false;
}

/** The type a category head names, or null when no rule matches. Pure. */
export function gigTypeFromCategory(category: string | null | undefined): Exclude<GigType, "other"> | null {
  const head = String(category ?? "").split("·")[0] ?? "";
  const toks = tokens(head);
  if (toks.length === 0) return null;
  for (const r of RULES) if (r.phrases.some((p) => hasPhrase(toks, p))) return r.type;
  for (const r of RULES) {
    if (r.words.some((w) => toks.includes(w))) return r.type;
    if (r.prefixes.some((p) => toks.some((t) => t.startsWith(p)))) return r.type;
  }
  return null;
}

/** The arena's fallback when the brief names nothing (or there is no brief yet). */
export const GIG_ARENA_TYPE: Readonly<Record<GigArena, GigType>> = {
  security: "security",
  competition: "data-ml",
  freelance: "other",
  oss_bounty: "other",
};

export type GigTypeInput = Pick<Gig, "arena"> & { brief: Pick<GigBrief, "category"> | null };

/** The kind of work a gig is: the brief category's head by the keyword rules, else the
 *  arena's fallback. Pure. */
export function gigTypeOf(gig: GigTypeInput): GigType {
  return gigTypeFromCategory(gig.brief?.category) ?? GIG_ARENA_TYPE[gig.arena];
}

// ---------------------------------------------------------------------------
// Knowledge: the registry subjects a gig persona of each type is hired with
// ---------------------------------------------------------------------------

export type GigKnowledgeSubject = { bundle: string; subject: string };

/** A subject as it rides the persona request's `requirements.knowledge` (<= 12). `path` is
 *  the golden path's file as the bundle index states it (`subjects[slug].file`, relative to
 *  the registry root) - resolved, never built from the slug. */
export type GigKnowledgeRef = { bundle: string; subject: string; title?: string; path?: string };

/** Personas' intake bound on `requirements.knowledge`. */
export const GIG_KNOWLEDGE_MAX = 12;

/** Slugs verified against the registry's software-engineering and marketing indexes on
 *  2026-09-29. A slug an index stops carrying is dropped at resolution, never guessed. */
export const GIG_TYPE_KNOWLEDGE: Readonly<Record<GigType, readonly GigKnowledgeSubject[]>> = {
  security: [
    { bundle: "software-engineering", subject: "authorization" },
    { bundle: "software-engineering", subject: "browser-credential-boundary" },
    { bundle: "software-engineering", subject: "supply-chain" },
  ],
  web: [
    { bundle: "software-engineering", subject: "error-handling" },
    { bundle: "software-engineering", subject: "data-access" },
    { bundle: "software-engineering", subject: "rate-limiting" },
  ],
  ui: [
    { bundle: "software-engineering", subject: "accessibility" },
    { bundle: "software-engineering", subject: "design-tokens" },
    { bundle: "software-engineering", subject: "async-ui-states" },
  ],
  "data-ml": [
    { bundle: "software-engineering", subject: "eval-harness" },
    { bundle: "software-engineering", subject: "measurement-honesty" },
  ],
  architecture: [
    { bundle: "software-engineering", subject: "module-design" },
    { bundle: "software-engineering", subject: "invariant-placement" },
  ],
  content: [{ bundle: "marketing", subject: "honest-proof-and-illustrative-data" }],
  other: [],
};
