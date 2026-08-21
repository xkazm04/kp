// Compound board filtering + sorting (perfect-board Direction 2). The board's
// filters were mutually-exclusive single-select — "aging AND interview" was
// unaskable, there was no score-range or source facet, and card order was fixed to
// input order. This module is the PURE core of the richer model, extracted so the
// composed predicate, the sort, and the URL/saved-view (de)serialization are all
// unit-pinnable under `node --test` (no React, no DOM, no DB): every function reads
// only plain Entry fields plus the same canonical score/aging helpers the rest of
// the board uses, so a filter can never diverge from what a card actually shows.
//
// Facet grammar
// -------------
//   • quick filters compose with AND — every selected chip must hold (so "aging"
//     AND "interview" narrows to their intersection; this is the motivating case).
//   • score bands and sources compose with OR WITHIN their dimension and AND across
//     dimensions — an entry has exactly one band and one source, so within-dimension
//     AND would be nonsensical (strong AND mid = ∅). Empty set = no constraint.
//   • the free-text query and the funnel-stage filter are single-valued, unchanged.

import { needsHumanDecision } from "@/app/_lib/approval-kinds";
import { DEFAULT_STAGE_AXIS, stagesWithRole, type StageDef } from "@/app/_lib/pipeline-stages";
import { canonicalScoreOf } from "@/app/_lib/match-score";
import { scoreTone } from "@/app/_lib/format";
import { agingBucket } from "./pipelineRenderDiet";
import { type Entry } from "@/app/features/shared/pipelineTypes";

const DAY_MS = 86_400_000;

// The quick-filter toggles (free-text name/role search runs alongside). Canonical
// value list so the ?quick= deep-link param validates against the same set the chips
// render from. Moved here from PipelineTab so the predicate and the param parser
// share one source.
export const QUICK_FILTERS = ["interview", "aging", "awaiting", "intake"] as const;
export type QuickFilter = (typeof QUICK_FILTERS)[number];

// Score bands, kept in lock-step with the canonical scoreTone tiers (format.ts:
// strong ≥ 75, mid ≥ 50, weak < 50) that the board's ScoreBadge already paints — so
// a candidate can never read "strong" on the card and fall in the "mid" filter band.
// "unscored" is its OWN honest bucket (a missing canonical score is never coerced
// into "weak").
export const SCORE_BANDS = ["strong", "mid", "weak", "unscored"] as const;
export type ScoreBandKey = (typeof SCORE_BANDS)[number];

// Sort options applied WITHIN each lane's cells (lane order stays title-sorted).
// "insertion" preserves the server's input order (the current, default behavior).
export const SORTS = ["insertion", "score", "age"] as const;
export type SortKey = (typeof SORTS)[number];

// Sentinel for the null/absent source channel, so an "unattributed" facet is a real,
// selectable value distinct from "no source constraint" (an empty selection).
export const UNATTRIBUTED_SOURCE = "__none__";

/** The score band an entry falls in, via the canonical score + scoreTone tiers. A
 *  null/non-finite canonical score is its own "unscored" band, never "weak". */
export function entryScoreBand(e: Entry): ScoreBandKey {
  const tone = scoreTone(canonicalScoreOf(e));
  return tone === "null" ? "unscored" : tone; // "strong" | "mid" | "weak"
}

/** The source/channel facet value for an entry — the stored sourceChannel, or the
 *  UNATTRIBUTED sentinel for a null/absent one (recruiter-sourced / legacy). */
export function entrySource(e: Entry): string {
  return e.sourceChannel ?? UNATTRIBUTED_SOURCE;
}

/** One quick-filter predicate. `aging` reuses the render-diet's agingBucket so the
 *  chip, the amber dot, and the staleCount stat are provably the same verdict; the
 *  rest read plain fields. `now`/`overrides` are injectable for tests. */
export function quickPredicate(
  e: Entry,
  f: QuickFilter,
  overrides: Record<string, number> | null | undefined,
  now: number,
  axis: readonly StageDef[] = DEFAULT_STAGE_AXIS
): boolean {
  switch (f) {
    case "aging":
      return agingBucket(e, overrides, now, axis) === 1;
    case "awaiting":
      return needsHumanDecision(e.approvalKind) && e.status === "active";
    case "intake":
      return Boolean(e.intakeDegraded) && e.status !== "rejected";
    case "interview":
      // By ROLE, not by the name: an axis may declare several interview columns (the
      // composer tells operators to add them), and this filtered set feeds bulk
      // select-all — so a name test made "invite everyone in interview" reach a
      // strict subset of them.
      return stagesWithRole("interview", axis).includes(e.stage);
    default:
      return true;
  }
}

// The filter dimensions an entry is tested against (sort is applied separately).
export type FilterCriteria = {
  query: string;
  quicks: ReadonlySet<QuickFilter>;
  scoreBands: ReadonlySet<ScoreBandKey>;
  sources: ReadonlySet<string>;
  stage: string | null;
};

/** The composed predicate: query ∧ stage ∧ (⋀ quicks) ∧ (score ∈ bands) ∧
 *  (source ∈ sources). Empty band/source sets impose no constraint. Pure over
 *  (entry, criteria, now, overrides). */
export function entryMatchesFilters(
  e: Entry,
  c: FilterCriteria,
  ctx?: { overrides?: Record<string, number> | null; now?: number; axis?: readonly StageDef[] }
): boolean {
  const now = ctx?.now ?? Date.now();
  const overrides = ctx?.overrides ?? null;
  const axis = ctx?.axis ?? DEFAULT_STAGE_AXIS;
  const q = c.query.trim().toLowerCase();
  if (q) {
    const hit = (e.candidateLabel ?? "").toLowerCase().includes(q) || (e.jobTitle ?? "").toLowerCase().includes(q);
    if (!hit) return false;
  }
  if (c.stage && e.stage !== c.stage) return false;
  // quicks — AND: every selected quick must hold.
  for (const f of c.quicks) if (!quickPredicate(e, f, overrides, now, axis)) return false;
  // score bands — OR within the dimension; empty = unconstrained.
  if (c.scoreBands.size > 0 && !c.scoreBands.has(entryScoreBand(e))) return false;
  // sources — OR within the dimension; empty = unconstrained.
  if (c.sources.size > 0 && !c.sources.has(entrySource(e))) return false;
  return true;
}

// The sort key for an entry, higher = earlier. Unscored / undated entries sink to
// the bottom (a sentinel below any real value) rather than jumping to the top.
function scoreOrderKey(e: Entry): number {
  const s = canonicalScoreOf(e);
  return typeof s === "number" && Number.isFinite(s) ? s : -1;
}
// Days the card has sat in its current stage at `now`; undated sinks to the bottom.
// Injectable `now` keeps the sort deterministic under test (daysSince reads the
// real clock, which a fixed-instant test can't pin).
function ageOrderKey(e: Entry, now: number): number {
  if (!e.stageChangedAt) return -1;
  const t = Date.parse(e.stageChangedAt);
  return Number.isFinite(t) ? Math.floor((now - t) / DAY_MS) : -1;
}

/** Apply the chosen sort to an already-filtered list, WITHIN the given order (lanes
 *  are grouped downstream, so this sorts cards within each cell). "insertion"
 *  returns the input untouched (default board order). Array.prototype.sort is stable
 *  (V8/Node), so equal keys keep their insertion order. Returns a NEW array for the
 *  non-trivial sorts so the caller's source list is never mutated. */
export function sortFilteredEntries(entries: readonly Entry[], sort: SortKey, ctx?: { now?: number }): Entry[] {
  if (sort === "insertion") return entries as Entry[];
  const now = ctx?.now ?? Date.now();
  const copy = [...entries];
  if (sort === "score") copy.sort((a, b) => scoreOrderKey(b) - scoreOrderKey(a));
  else if (sort === "age") copy.sort((a, b) => ageOrderKey(b, now) - ageOrderKey(a, now));
  return copy;
}

// --- URL <-> state (de)serialization (PIPE3 idiom) --------------------------------
// Multi-value facets travel as CSV in a single param (?quick=aging,interview,
// ?score=strong,unscored, ?source=apply,__none__); sort as a single ?sort= value.
// CSV (not repeated params) keeps the params compatible with buildUrl's
// Record<string,string|null> shape and the existing single-value ?quick= reader.

function csvToSet<T extends string>(raw: string | null, allowed: readonly T[]): Set<T> {
  const set = new Set<T>();
  if (!raw) return set;
  const ok = new Set<string>(allowed);
  for (const part of raw.split(",")) {
    const v = part.trim();
    if (v && ok.has(v)) set.add(v as T);
  }
  return set;
}

/** Parse ?quick= — CSV of valid QuickFilter values. A legacy single value
 *  (?quick=aging) parses to a one-element set, so old deep links still land. */
export function parseQuicksParam(raw: string | null): Set<QuickFilter> {
  return csvToSet(raw, QUICK_FILTERS);
}
export function parseScoreBandsParam(raw: string | null): Set<ScoreBandKey> {
  return csvToSet(raw, SCORE_BANDS);
}
/** Sources are open-ended (channel ids + the unattributed sentinel), so any
 *  non-empty comma-free token is accepted; empties are dropped. */
export function parseSourcesParam(raw: string | null): Set<string> {
  const set = new Set<string>();
  if (!raw) return set;
  for (const part of raw.split(",")) {
    const v = part.trim();
    if (v) set.add(v);
  }
  return set;
}
export function parseSortParam(raw: string | null): SortKey {
  return raw && (SORTS as readonly string[]).includes(raw) ? (raw as SortKey) : "insertion";
}

/** Serialize a set to a canonical CSV (or null when empty, so buildUrl drops the
 *  param). `order` pins a stable output so the same selection always yields the same
 *  URL (bookmarkable, and stable for the active-view equality check). */
export function serializeSet<T extends string>(set: ReadonlySet<T>, order?: readonly T[]): string | null {
  if (set.size === 0) return null;
  const values = order ? order.filter((v) => set.has(v)) : [...set].sort();
  return values.length ? values.join(",") : null;
}
export const serializeQuicks = (s: ReadonlySet<QuickFilter>) => serializeSet(s, QUICK_FILTERS);
export const serializeScoreBands = (s: ReadonlySet<ScoreBandKey>) => serializeSet(s, SCORE_BANDS);
export const serializeSources = (s: ReadonlySet<string>) => serializeSet(s);
export const serializeSort = (sort: SortKey): string | null => (sort === "insertion" ? null : sort);

// --- Saved views (PIPE5) ----------------------------------------------------------
// A named snapshot of the whole filter+sort combo. `quick` (single) is the legacy
// field; the richer facets are optional so a view persisted before this direction
// hydrates gracefully (single quick → one-element set, no score/source, insertion
// sort). We WRITE the new shape (quicks/score/source/sort) and keep `quick` for
// forward safety.
export type SavedView = {
  id: string;
  name: string;
  query: string;
  quick?: QuickFilter | null; // legacy single-select
  quicks?: QuickFilter[];
  score?: ScoreBandKey[];
  source?: string[];
  sort?: SortKey;
  stage?: string | null;
  // views-earn-their-name: at most one view carries this flag — it opens on a bare
  // visit (no explicit URL filter params). Optional so a view persisted before this
  // direction (no flag) hydrates fine. The collection-level logic (enforce-one,
  // default precedence) lives in pipeline-views.ts.
  isDefault?: boolean;
};

// A saved view normalized to full state — every legacy gap filled with an honest
// default, every value validated against its allowed set.
export type NormalizedView = {
  id: string;
  name: string;
  query: string;
  quicks: QuickFilter[];
  scoreBands: ScoreBandKey[];
  sources: string[];
  sort: SortKey;
  stage: string | null;
};

const keepAllowed = <T extends string>(vals: readonly string[] | undefined, allowed: readonly T[]): T[] => {
  if (!vals) return [];
  const ok = new Set<string>(allowed);
  return vals.filter((v): v is T => ok.has(v));
};

/** Migrate any stored SavedView (legacy single-quick or the richer shape) to full
 *  normalized state. Legacy `quick` becomes a one-element `quicks`; absent facets
 *  become empty; absent sort becomes "insertion". Values are validated so a corrupt
 *  or renamed enum silently drops rather than poisoning the predicate. */
export function normalizeView(v: SavedView): NormalizedView {
  const quicks = v.quicks ? keepAllowed(v.quicks, QUICK_FILTERS) : v.quick && (QUICK_FILTERS as readonly string[]).includes(v.quick) ? [v.quick] : [];
  return {
    id: v.id,
    name: v.name,
    query: v.query ?? "",
    quicks,
    scoreBands: keepAllowed(v.score, SCORE_BANDS),
    sources: (v.source ?? []).filter((s) => typeof s === "string" && s.length > 0),
    sort: parseSortParam(v.sort ?? null),
    stage: v.stage ?? null,
  };
}

/** Set equality by membership (order-independent) — for the active-view check. */
export function setsEqual<T>(a: ReadonlySet<T>, b: readonly T[]): boolean {
  if (a.size !== b.length) return false;
  for (const v of b) if (!a.has(v)) return false;
  return true;
}
