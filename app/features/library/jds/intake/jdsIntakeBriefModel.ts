// Pure shaping for the live-brief panel: the reading order, the tone bands and
// — the part that carries the most weight — the de-duplication of facets against
// what the panel already showed above them.
//
// No React, no next-intl: the rules are the contract the panel variants share
// (jdsIntakeBriefModel.test.ts pins them), so a variant can only differ in how
// it DRAWS the brief, never in what it counts as a duplicate.
//
// Why de-duplication is a model concern and not a styling one: the engine emits
// `successCriteria` AND an `objective:*` / `success_90d` facet carrying the same
// sentence, so the flat "Context" list printed the requestor's own 90-day
// sentence a second time, verbatim, four lines under the first (observed live in
// both the App-master and the Czech backfill briefs). A reader scanning for what
// is new cannot tell the repeat from a second commitment.

import type { RoleBrief } from "@/app/_lib/rolespec";

export type BriefFacet = NonNullable<RoleBrief["facets"]>[number];
export type BriefRequirement = NonNullable<RoleBrief["requirements"]>[number];

/** The three readings a value can have, as the panel tones them:
 *  stated = the requestor's words (moss) · inferred = the agent's reading
 *  (amber) · default = template fill (steel). Anything unknown reads as a
 *  template fill — the most cautious of the three. */
export type ProvenanceTone = "stated" | "inferred" | "default";

export function provenanceTone(provenance?: string | null): ProvenanceTone {
  return provenance === "stated" || provenance === "inferred" ? provenance : "default";
}

/** Weight → the shared score band, so a dealbreaker's bar uses the same three
 *  tones as every other ranked surface in the app (`--color-score-*`). */
export type WeightBand = "strong" | "mid" | "weak";

export function weightBand(weight?: number | null): WeightBand {
  const w = typeof weight === "number" ? weight : 0;
  if (w >= 0.8) return "strong";
  if (w >= 0.5) return "mid";
  return "weak";
}

/** How loudly a facet is drawn. The engine already grades every facet
 *  `core` / `valuable` / `context` and the flat list threw that away — every
 *  line rendered at the same volume, which is most of why the panel reads as a
 *  wall. Unknown grades sort with `valuable`: visible, not shouted. */
const IMPORTANCE_RANK: Record<string, number> = { core: 0, valuable: 1, context: 2 };

export function importanceRank(importance?: string | null): number {
  return IMPORTANCE_RANK[importance ?? ""] ?? 1;
}

/** Dealbreakers first and heaviest-first inside that — the order a reader would
 *  put them in themselves. Stable: equal weights keep the engine's order. */
export function sortByWeight<T extends { weight?: number | null }>(items: readonly T[]): T[] {
  return items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => (b.item.weight ?? 0) - (a.item.weight ?? 0) || a.i - b.i)
    .map((entry) => entry.item);
}

/* ── de-duplication ──────────────────────────────────────────────────────── */

/** Lowercased, punctuation-free, single-spaced. Deliberately NOT diacritic-
 *  folded: `č` and `c` are different letters in the languages this app ships,
 *  and the comparisons below are between two strings from the SAME brief, so
 *  they agree on spelling. */
function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[.,;:!?—–\-()[\]"'`]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(value: string): string[] {
  return normalize(value)
    .split(" ")
    .filter((w) => w.length >= 3);
}

/** Near-duplicate test for two sentences produced by the same extraction pass.
 *  Exact match after normalization, or — the live shape — one sentence being the
 *  other plus connective words ("Do 90 dnů **převezme Jardovy služby a** on-call
 *  rotace běží bez výpadků" vs the facet's "Převezme Jardovy služby, on-call
 *  rotace běží bez výpadků"): every meaningful word of the shorter appears in
 *  the longer. Guarded at 5 tokens so short values ("Praha", "Rung 0") can never
 *  swallow each other on coincidence. */
export function isNearDuplicate(a: string, b: string): boolean {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const ta = tokens(a);
  const tb = tokens(b);
  const [shorter, longer] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  if (shorter.length < 5) return false;
  const haystack = new Set(longer);
  const covered = shorter.filter((w) => haystack.has(w)).length;
  return covered / shorter.length >= 0.8;
}

/** "gate pass rate — 95% within 60 days" under the label "gate pass rate"
 *  becomes "95% within 60 days". The engine writes the label into the value on
 *  the `objective:*` facets, so the panel printed the same three words twice on
 *  one line, once as the label and once as the head of the value. */
export function trimLabelPrefix(label: string, value: string): string {
  const l = normalize(label);
  const v = value.trim();
  if (!l || normalize(v) === l) return v;
  if (!normalize(v).startsWith(l)) return v;
  const rest = v.slice(label.trim().length).replace(/^\s*[—–:\-·]\s*/, "").trim();
  return rest.length > 0 ? rest : v;
}

export type PreparedFacet = BriefFacet & {
  /** The value with a repeated label head removed — what the panel renders. */
  displayValue: string;
};

export type FacetGroup = {
  /** Namespace before the first `.` or `:` (`mandate.owner` → `mandate`), or
   *  `general` for the flat keys the conversational shapes emit (`why_now`). */
  key: string;
  items: PreparedFacet[];
};

export const GENERAL_FACET_GROUP = "general";

function namespaceOf(key: string): string {
  const cut = key.search(/[.:]/);
  return cut > 0 ? key.slice(0, cut) : GENERAL_FACET_GROUP;
}

/**
 * The context block, cleaned and grouped.
 *
 * Drops, in this order: an empty value; a value the panel already printed as a
 * 90-day outcome or as the role's own title/seniority; and a facet repeating one
 * already kept (same key AND same value — the live `why_now` ×2 case keeps BOTH
 * because their values differ, which is a real second answer, not an echo).
 *
 * Then groups by key namespace, in first-appearance order, and orders each
 * group's items by the engine's own `importance` grade.
 */
export function prepareFacets(brief: RoleBrief | null): FacetGroup[] {
  const facets = brief?.facets ?? [];
  const criteria = brief?.successCriteria ?? [];
  const spine = [brief?.title ?? "", brief?.seniority ?? ""].filter(Boolean);
  const groups = new Map<string, PreparedFacet[]>();
  const seen = new Set<string>();

  for (const facet of facets) {
    const value = (facet.value ?? "").trim();
    if (!value) continue;
    if (criteria.some((c) => isNearDuplicate(c, value))) continue;
    if (spine.some((s) => normalize(s) === normalize(value))) continue;
    const fingerprint = `${facet.key ?? ""}::${normalize(value)}`;
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    const key = namespaceOf(facet.key ?? "");
    const prepared: PreparedFacet = { ...facet, displayValue: trimLabelPrefix(facet.label ?? "", value) };
    const bucket = groups.get(key);
    if (bucket) bucket.push(prepared);
    else groups.set(key, [prepared]);
  }

  return [...groups.entries()].map(([key, items]) => ({
    key,
    items: items
      .map((item, i) => ({ item, i }))
      .sort((a, b) => importanceRank(a.item.importance) - importanceRank(b.item.importance) || a.i - b.i)
      .map((entry) => entry.item),
  }));
}

/** Count of everything the panel actually renders — the number the folded
 *  spine badge should report, now that the context block drops repeats. */
export function briefItemCount(brief: RoleBrief | null): number {
  return (
    (brief?.requirements ?? []).length +
    (brief?.successCriteria ?? []).length +
    prepareFacets(brief).reduce((n, g) => n + g.items.length, 0)
  );
}
