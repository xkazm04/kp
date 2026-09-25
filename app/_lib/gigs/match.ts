import type { AgentStatus } from "../db/agents";
import { GIG_KPI_SMALL_SAMPLE, type Gig, type GigBrief, type GigSpecialist } from "./types";

// Gig matchmaking: which of the workspace's specialists a gig should go to, ranked, with
// the reasons as codes a reader can check. PURE, deterministic and keyless - no db, no
// clock, no model - and client-safe (type-only imports), so the gig page ranks with the
// very function the qualifier uses (qualify.ts rankGigSpecialists is the store-backed
// caller; docs/features/gigs/README.md "Matchmaking and routing").
//
// The signals, stated once:
//   arena          must match, else the specialist is not a candidate at all
//   routed niche   the gig's `niche` (set when the operator routes it) equal to the
//                  specialist's niche -> 100: a routing decision stays stable
//   niche fit      the specialist's niche terms found in the gig's brief category
//                  (weight 1.0), its tags (0.85) or its title / brief title (0.7);
//                  normalized, lightly stemmed, stopwords out, and folded through ONE
//                  synonym table (GIG_NICHE_SYNONYMS). Generic words ("development",
//                  "design", "services") count at 0.4. Up to NICHE_MAX points: half for
//                  how much of the niche the gig covers, half for how strong the hits are
//                  (two full hits saturate), so a long niche is not punished for its length
//   generalist     a niche with no terms left ("general") -> GENERALIST_POINTS: it takes
//                  anything, below every real fit
//   record         the specialist's accepted / resolved outcomes (kpi.ts), damped under
//                  GIG_KPI_SMALL_SAMPLE resolved - up to RECORD_MAX points, added only to
//                  a specialist that already fits, so it breaks ties and never matches
//   ready          the hire is runnable (onboarding | active). Not part of the score: a
//                  specialist still waiting on Personas is ranked and shown, not picked.
// Order: score desc, then ready first, then the gig's current match, then the oldest
// specialist, then id - stable.

export const MATCH_WEIGHTS = {
  nicheMax: 90,
  recordMax: 10,
  generalist: 15,
  routed: 100,
  field: { category: 1, tags: 0.85, title: 0.7 },
  genericTerm: 0.4,
  /** Weighted hits at which the "strength" half of niche fit saturates. */
  strengthSaturation: 2,
} as const;

/** Hire statuses under which the specialist's persona exists in Personas and may run. */
export const GIG_RUNNABLE_HIRE_STATUSES: readonly AgentStatus[] = ["onboarding", "active"];

/** Common freelance areas, one concept per row: any word in a row matches any other.
 *  Words are stored as written; they pass through the same stemmer as the text. */
export const GIG_NICHE_SYNONYMS: Readonly<Record<string, readonly string[]>> = {
  web: ["web", "website", "websites", "frontend", "webpage", "webapp", "landing", "html", "css"],
  data: ["data", "excel", "sheets", "spreadsheet", "analysis", "analytics", "analyst", "dashboard"],
  writing: ["writing", "write", "writer", "content", "copy", "copywriting", "copywriter", "article", "blog"],
  ai: ["ai", "llm", "agents", "automation", "automate", "chatbot", "gpt", "ml"],
};

const STOPWORDS = new Set([
  "a", "an", "and", "or", "the", "for", "of", "to", "in", "on", "with", "by", "from", "at", "as", "is", "are", "be",
  "this", "that", "vs", "via", "into", "using", "new", "need", "needed", "looking", "help", "want", "we", "you",
  "your", "our", "my", "it", "its", "general", "etc", "other", "misc",
]);

/** Words that say little about the niche on their own; they count at MATCH_WEIGHTS.genericTerm. */
const GENERIC = new Set(
  [
    "development", "develop", "developer", "design", "designer", "engineering", "engineer", "service", "services",
    "solution", "solutions", "support", "project", "work", "expert", "specialist", "professional", "build", "custom",
    "tool", "tools", "system", "systems", "business",
  ].map(stem)
);

/** Light stemming: enough that "reports" meets "report" and "consulting" meets "consult". */
function stem(w: string): string {
  if (w.length > 5 && w.endsWith("ing")) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith("ies")) return `${w.slice(0, -3)}y`;
  if (w.length > 3 && w.endsWith("s") && !/(ss|is|us)$/.test(w)) return w.slice(0, -1);
  return w;
}

const CONCEPT_OF = new Map<string, string>();
for (const [concept, words] of Object.entries(GIG_NICHE_SYNONYMS)) {
  for (const w of words) CONCEPT_OF.set(stem(w), concept);
}

function normalizeText(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\bfront[\s-]+end\b/g, "frontend")
    .replace(/\bback[\s-]+end\b/g, "backend")
    .replace(/\bfull[\s-]+stack\b/g, "fullstack")
    .replace(/\bweb[\s-]+site\b/g, "website");
}

/** Word -> concept key: the synonym row's key, else the stemmed word itself. */
function conceptOf(word: string): string {
  const s = stem(word);
  return CONCEPT_OF.get(s) ?? s;
}

/** The words of `text` (normalized, stopwords out), each with its concept key. */
function words(text: string): { word: string; concept: string }[] {
  const out: { word: string; concept: string }[] = [];
  for (const w of normalizeText(text).split(/[^a-z0-9+#]+/)) {
    if (w.length < 2 || STOPWORDS.has(w)) continue;
    out.push({ word: w, concept: conceptOf(w) });
  }
  return out;
}

function conceptSet(text: string): Set<string> {
  return new Set(words(text).map((w) => w.concept));
}

/** A niche label as compared for "routed": one line, collapsed, case-insensitive. */
export function normalizeNicheLabel(niche: string | null | undefined): string {
  return (niche ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

export const GIG_MATCH_REASON_CODES = [
  "routed",
  "category_terms",
  "tag_terms",
  "title_terms",
  "generalist",
  "no_overlap",
  "record",
  "hire_not_ready",
  "no_hire",
] as const;
export type GigMatchReasonCode = (typeof GIG_MATCH_REASON_CODES)[number];

/** A reason as a code plus short evidence (matched words, "3/4", a hire status); the UI
 *  words the code, the evidence is shown as data. */
export type GigMatchReason = { code: GigMatchReasonCode; evidence: string | null };

export type GigMatch = {
  specialistId: string;
  /** 0..100, deterministic. 0 = nothing in the gig points at this specialist. */
  score: number;
  reasons: GigMatchReason[];
  /** The hire is runnable (onboarding | active): a dispatch could start now. */
  ready: boolean;
};

/** `specialistId` (optional) is the gig's current match: on an exact tie it stays first,
 *  so re-ranking an unchanged gig never flips its specialist. */
export type GigMatchGig = Pick<Gig, "arena" | "title" | "tags" | "niche"> & {
  brief: Pick<GigBrief, "category" | "title"> | null;
  specialistId?: string | null;
};

export type GigMatchCandidate = {
  specialist: Pick<GigSpecialist, "id" | "spec" | "createdAt">;
  /** The hired_agents status; null when the hire row is gone. */
  hireStatus: string | null;
  /** The specialist's resolved sent work (kpi.ts bySpecialist); null = none yet. */
  record: { accepted: number; resolved: number } | null;
};

type Field = keyof typeof MATCH_WEIGHTS.field;
const FIELD_CODE: Record<Field, GigMatchReasonCode> = { category: "category_terms", tags: "tag_terms", title: "title_terms" };

function recordPoints(record: GigMatchCandidate["record"]): number {
  if (!record || record.resolved <= 0) return 0;
  const rate = Math.max(0, Math.min(1, record.accepted / record.resolved));
  const damp = Math.min(1, record.resolved / GIG_KPI_SMALL_SAMPLE);
  return Math.round(MATCH_WEIGHTS.recordMax * rate * damp);
}

/** One specialist against one gig (the arena already checked). */
function scoreCandidate(fields: Record<Field, Set<string>>, gig: GigMatchGig, c: GigMatchCandidate): GigMatch {
  const reasons: GigMatchReason[] = [];
  let score = 0;
  let fits = false;
  const niche = c.specialist.spec.niche ?? "";

  if (gig.niche && normalizeNicheLabel(gig.niche) === normalizeNicheLabel(niche)) {
    score = MATCH_WEIGHTS.routed;
    fits = true;
    reasons.push({ code: "routed", evidence: niche.trim() || null });
  } else {
    // The niche's concepts, each labelled by the first word that produced it.
    const terms = new Map<string, { label: string; weight: number }>();
    for (const w of words(niche)) {
      if (!terms.has(w.concept)) terms.set(w.concept, { label: w.word, weight: GENERIC.has(stem(w.word)) ? MATCH_WEIGHTS.genericTerm : 1 });
    }
    if (terms.size === 0) {
      score = MATCH_WEIGHTS.generalist;
      fits = true;
      reasons.push({ code: "generalist", evidence: null });
    } else {
      let total = 0;
      let hit = 0;
      const byField: Record<Field, string[]> = { category: [], tags: [], title: [] };
      for (const [concept, t] of terms) {
        total += t.weight;
        // A term counts once, in the strongest field that carries it.
        const field = (["category", "tags", "title"] as const).find((f) => fields[f].has(concept));
        if (!field) continue;
        hit += t.weight * MATCH_WEIGHTS.field[field];
        byField[field].push(t.label);
      }
      if (hit > 0) {
        const coverage = hit / total;
        const strength = Math.min(1, hit / MATCH_WEIGHTS.strengthSaturation);
        score = Math.round(MATCH_WEIGHTS.nicheMax * ((coverage + strength) / 2));
        fits = score > 0;
        for (const f of ["category", "tags", "title"] as const) {
          if (byField[f].length > 0) reasons.push({ code: FIELD_CODE[f], evidence: byField[f].join(", ") });
        }
      } else {
        reasons.push({ code: "no_overlap", evidence: null });
      }
    }
  }

  if (fits && score < 100) {
    const pts = recordPoints(c.record);
    if (pts > 0 && c.record) {
      score = Math.min(100, score + pts);
      reasons.push({ code: "record", evidence: `${c.record.accepted}/${c.record.resolved}` });
    }
  }

  const ready = c.hireStatus !== null && (GIG_RUNNABLE_HIRE_STATUSES as readonly string[]).includes(c.hireStatus);
  if (c.hireStatus === null) reasons.push({ code: "no_hire", evidence: null });
  else if (!ready) reasons.push({ code: "hire_not_ready", evidence: c.hireStatus });

  return { specialistId: c.specialist.id, score: Math.max(0, Math.min(100, score)), reasons, ready };
}

/** Rank the specialists for a gig: same-arena only, sorted score desc, then ready first,
 *  then the oldest, then id. Pure. */
export function rankSpecialistsForGig(gig: GigMatchGig, candidates: readonly GigMatchCandidate[]): GigMatch[] {
  const fields: Record<Field, Set<string>> = {
    category: conceptSet(gig.brief?.category ?? ""),
    tags: conceptSet(gig.tags.join(" · ")),
    title: conceptSet(`${gig.title} ${gig.brief?.title ?? ""}`),
  };
  const current = gig.specialistId ?? null;
  const created = new Map<string, string>();
  const ranked: GigMatch[] = [];
  for (const c of candidates) {
    if (c.specialist.spec.arena !== gig.arena) continue;
    created.set(c.specialist.id, c.specialist.createdAt);
    ranked.push(scoreCandidate(fields, gig, c));
  }
  return ranked.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    if (a.ready !== b.ready) return a.ready ? -1 : 1;
    if (current && (a.specialistId === current) !== (b.specialistId === current)) return a.specialistId === current ? -1 : 1;
    const ca = created.get(a.specialistId) ?? "";
    const cb = created.get(b.specialistId) ?? "";
    if (ca !== cb) return ca < cb ? -1 : 1;
    return a.specialistId < b.specialistId ? -1 : a.specialistId > b.specialistId ? 1 : 0;
  });
}

/** The match the qualifier and dispatch take: the best READY candidate that scores above
 *  0, else none. Pure. */
export function pickGigMatch(ranked: readonly GigMatch[]): GigMatch | null {
  return ranked.find((m) => m.ready && m.score > 0) ?? null;
}

/** The gig statuses the operator may route (or un-route) in: before a dispatch claims the
 *  gig, and between attempts. Never while `dispatched` (a run is using the specialist),
 *  never a suspect gig, never once it left the line. */
export const GIG_ROUTABLE_STATUSES = ["new", "qualified", "drafted", "in_review"] as const satisfies readonly Gig["status"][];

/** Whether the operator may route this gig now. Pure; the route door and the page read it. */
export function canRouteGig(gig: Pick<Gig, "status" | "suspectReasons">): boolean {
  return (GIG_ROUTABLE_STATUSES as readonly string[]).includes(gig.status) && gig.suspectReasons.length === 0;
}

const SUGGEST_MAX = 80;

/** A short niche label for "hire a specialist for this niche": the brief category's head
 *  (the part after "·" dropped - "Web development · Typing test tool" -> "Web
 *  development"), else the listing's first tag, else null. Pure. */
export function suggestNicheForGig(gig: Pick<Gig, "tags"> & { brief: Pick<GigBrief, "category"> | null }): string | null {
  const head = (gig.brief?.category ?? "").split("·")[0]?.replace(/\s+/g, " ").trim() ?? "";
  if (head) return head.slice(0, SUGGEST_MAX);
  const tag = gig.tags.map((t) => t.replace(/\s+/g, " ").trim()).find((t) => t.length > 0);
  return tag ? tag.slice(0, SUGGEST_MAX) : null;
}
