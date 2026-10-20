// What the seeker's target titles ask for NOW, researched on the web - the pure half:
// the cache key, the record the store keeps, its re-validation, freshness. The research
// itself runs in pipeline/jobfit/role_research_cli.py on ONE pinned model (Claude Sonnet
// 5.5 through the Claude CLI with WebSearch + WebFetch, llm-config.ts PINNED_USE_CASES),
// never with anything about the person: only the titles and the markets leave the box.
//
// A research is a claim about the market with its sources, and it says so: every skill
// carries the source indices it came from, every source whether its page was READ or only
// seen as a search result, and the record keeps the model and the date. Keyless (no Claude
// CLI, KP_OFFLINE, production without the engine) the CLI answers `result: null` with the
// reason, and the reader falls back to the seeker's OWN postings (cvTailor demandFor) -
// saying which of the two it is showing.

import { createHash } from "node:crypto";

export const ROLE_RESEARCH_TIERS = ["core", "common", "emerging"] as const;
export type RoleResearchTier = (typeof ROLE_RESEARCH_TIERS)[number];

export type RoleResearchSource = { url: string; title: string | null; read: "fetched" | "snippet"; publisher: string | null };
export type RoleResearchSkill = { skill: string; termId: string | null; tier: RoleResearchTier; share: number | null; why: string; sources: number[] };
export type RoleResearch = {
  titles: string[];
  markets: string[];
  asOf: string;
  summary: string;
  skills: RoleResearchSkill[];
  sources: RoleResearchSource[];
};

/** What the store keeps per research (kind role_research, key = roleResearchKey). */
export type RoleResearchRecord = {
  key: string;
  titles: string[];
  markets: string[];
  research: RoleResearch | null;
  source: "llm" | "deterministic";
  fallbackReason: string | null;
  model: string | null;
  promptVersion: string | null;
  at: string;
};

/** A research this old is offered again: the market's mix moves, and a seeker deciding
 *  what to learn should not read last quarter's. */
export const ROLE_RESEARCH_FRESH_DAYS = 14;
export const ROLE_RESEARCH_MAX_TITLES = 5;

const fold = (s: string) => s.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();

/** The titles the research is about: the seeker's stated targets, trimmed, de-duplicated
 *  (case-folded), at most five - the CLI refuses more. */
export function researchTitles(targetTitles: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of targetTitles) {
    const clean = t.trim().replace(/\s+/g, " ").slice(0, 80);
    if (!clean || seen.has(fold(clean))) continue;
    seen.add(fold(clean));
    out.push(clean);
    if (out.length === ROLE_RESEARCH_MAX_TITLES) break;
  }
  return out;
}

/** ISO-2 markets, lower-case, de-duplicated, at most ten. */
export function researchMarkets(countries: readonly string[]): string[] {
  return [...new Set(countries.map((c) => c.trim().toLowerCase()).filter((c) => /^[a-z]{2}$/.test(c)))].slice(0, 10);
}

/** One research per (titles, markets), order-insensitive: "AI Engineer + ML Engineer in
 *  CZ, DE" is the same question however the seeker listed it. */
export function roleResearchKey(titles: readonly string[], markets: readonly string[]): string {
  const basis = JSON.stringify({ t: [...titles].map(fold).sort(), m: [...markets].sort() });
  return createHash("sha256").update(basis).digest("hex").slice(0, 24);
}

const str = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

function sourceOf(v: unknown): RoleResearchSource | null {
  if (!v || typeof v !== "object") return null;
  const s = v as Record<string, unknown>;
  const url = str(s.url, 500);
  if (!url || !/^https?:\/\//i.test(url)) return null;
  return { url, title: str(s.title, 160), read: s.read === "fetched" ? "fetched" : "snippet", publisher: str(s.publisher, 80) };
}

/** The research re-validated (the CLI's answer on the way in, the stored row on the way
 *  out): a skill must point at a source that survived; nothing unsourced is shown. */
export function roleResearchOf(value: unknown): RoleResearch | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const rawSources = Array.isArray(v.sources) ? v.sources : [];
  // Re-index: a dropped source must not shift another skill onto the wrong page.
  const index = new Map<number, number>();
  const sources: RoleResearchSource[] = [];
  rawSources.slice(0, 16).forEach((raw, i) => {
    const s = sourceOf(raw);
    if (!s) return;
    index.set(i, sources.length);
    sources.push(s);
  });
  const skills: RoleResearchSkill[] = [];
  const seen = new Set<string>();
  for (const raw of Array.isArray(v.skills) ? v.skills.slice(0, 24) : []) {
    if (!raw || typeof raw !== "object") continue;
    const s = raw as Record<string, unknown>;
    const skill = str(s.skill, 60);
    if (!skill || seen.has(fold(skill))) continue;
    const refs = (Array.isArray(s.sources) ? s.sources : [])
      .map((n) => (typeof n === "number" ? index.get(n) : undefined))
      .filter((n): n is number => n !== undefined);
    if (refs.length === 0) continue;
    seen.add(fold(skill));
    const share = typeof s.share === "number" && Number.isFinite(s.share) && s.share >= 0 && s.share <= 1 ? s.share : null;
    skills.push({
      skill,
      termId: str(s.termId, 80),
      tier: (ROLE_RESEARCH_TIERS as readonly string[]).includes(s.tier as string) ? (s.tier as RoleResearchTier) : "common",
      share,
      why: str(s.why, 200) ?? "",
      sources: [...new Set(refs)],
    });
  }
  if (skills.length === 0) return null;
  const titles = Array.isArray(v.titles) ? v.titles.map((t) => str(t, 80)).filter((t): t is string => t !== null) : [];
  const markets = Array.isArray(v.markets) ? v.markets.map((m) => str(m, 8)).filter((m): m is string => m !== null) : [];
  return { titles, markets, asOf: str(v.asOf, 10) ?? "", summary: str(v.summary, 400) ?? "", skills, sources };
}

export function roleResearchRecordOf(value: unknown): RoleResearchRecord | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const key = str(v.key, 64);
  const at = str(v.at, 40);
  if (!key || !at) return null;
  return {
    key,
    titles: Array.isArray(v.titles) ? v.titles.map((t) => str(t, 80)).filter((t): t is string => t !== null) : [],
    markets: Array.isArray(v.markets) ? v.markets.map((m) => str(m, 8)).filter((m): m is string => m !== null) : [],
    research: roleResearchOf(v.research),
    source: v.source === "llm" ? "llm" : "deterministic",
    fallbackReason: str(v.fallbackReason, 120),
    model: str(v.model, 80),
    promptVersion: str(v.promptVersion, 40),
    at,
  };
}

/** Whether a stored record still answers the question (young enough, and a real answer:
 *  a keyless miss is re-tried on the next ask, never cached as the market's word). */
export function isFreshResearch(record: RoleResearchRecord | null, now: Date = new Date()): boolean {
  if (!record || !record.research) return false;
  const age = now.getTime() - Date.parse(record.at);
  return Number.isFinite(age) && age >= 0 && age < ROLE_RESEARCH_FRESH_DAYS * 24 * 60 * 60_000;
}
