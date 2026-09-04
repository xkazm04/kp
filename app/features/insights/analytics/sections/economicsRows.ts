// The Economics board's row model: three acquisition taxonomies normalized onto ONE
// set of unit-economics columns.
//
// Pure and separate from the component for one reason — the normalization is the
// part that can lie. `bySource` and `byChannel` arrive from the server carrying a
// pre-computed `hireRatePct`, `byVariant` carries none and the board computed its
// own, and the three disagreed about the empty case: the server sends a rate for a
// surface with no applicants, and the board's inline `r.total ? … : 0` invented a
// literal 0 % for a variant nobody has ever applied through. Rendered, that is a
// creative sitting at "0 % hire rate" beside the roles table, which prints "—" for
// exactly the same situation (AnalyticsByRoleTable) — one page, two answers to
// "we have no data".
//
// So the rate is derived HERE, once, for all three groups, and its absent case is a
// value (`null`) rather than a rendering convention two call sites had to remember.
import type { EconomicsAnalytics } from "./economicsTypes";

export type EconomicsKind = "channel" | "source" | "variant";

export type EconomicsRow = {
  key: string;
  kind: EconomicsKind;
  name: string;
  /** The STORED channel id (not the display label) — the write key for the spend
   *  endpoint and the board's `?source=` filter value. Null on the two taxonomies
   *  that have no stored channel of their own. */
  channelId: string | null;
  total: number;
  reachedInterview: number;
  hired: number;
  /** Hires ÷ applicants, as a percentage — or `null` when the surface has no
   *  applicants at all. NOT `0`: a rate is undefined over an empty population, and
   *  a fabricated zero reads as "we tried and hired nobody", which is a judgement
   *  about a creative that has never been run. */
  hireRatePct: number | null;
  spendCzk: number | null;
  /** When a human last typed `spendCzk`. Rendered beside the derived per-hire figure
   *  so a six-week-old entry reads as six weeks old. */
  spendUpdatedAt: string | null;
  costPerHireCzk: number | null;
};

/** The one hire-rate rule on this page. Absent population → absent rate. */
export function hireRate(hired: number, total: number): number | null {
  if (!total) return null;
  return Math.round((hired / total) * 100);
}

/** Build the board's rows from the analytics payload. `names` supplies the two
 *  localized label lookups the component owns (channel ids and first-touch source
 *  slugs both resolve through catalogs), so this stays free of React and next-intl
 *  and can be driven directly by a test. */
export function economicsRows(
  data: EconomicsAnalytics,
  names: { channel: (id: string) => string; source: (slug: string) => string }
): EconomicsRow[] {
  return [
    ...data.byChannel.map((r) => ({
      key: `channel:${r.channel}`,
      kind: "channel" as const,
      name: names.channel(r.channel),
      channelId: r.channel,
      total: r.total,
      reachedInterview: r.reachedInterview,
      hired: r.hired,
      // Re-derived rather than passed through: the server's `hireRatePct` is a
      // number for every row including the empty ones, so trusting it here would
      // reinstate the fabricated zero for a channel with no applicants — the exact
      // defect this module exists to remove. Same arithmetic, so a populated row is
      // byte-identical to what the server sent.
      hireRatePct: hireRate(r.hired, r.total),
      spendCzk: r.spendCzk,
      spendUpdatedAt: r.spendUpdatedAt,
      costPerHireCzk: r.costPerHireCzk,
    })),
    ...data.bySource.map((r) => ({
      key: `source:${r.source}`,
      kind: "source" as const,
      name: names.source(r.source),
      channelId: null,
      total: r.total,
      reachedInterview: r.reachedInterview,
      hired: r.hired,
      hireRatePct: hireRate(r.hired, r.total),
      // First-touch origin carries no spend of its own — spend is recorded per
      // CHANNEL. A zero here would read as "free"; null reads as "not measured".
      spendCzk: null,
      spendUpdatedAt: null,
      costPerHireCzk: null,
    })),
    ...data.byVariant.map((r) => ({
      // A creative is only identified WITHIN its campaign/role — two roles can both
      // run an "A" variant, and merging them would invent a comparison.
      key: `variant:${r.jobTitle ?? ""}:${r.campaign ?? ""}:${r.variant}`,
      kind: "variant" as const,
      name: [r.variant, r.jobTitle].filter(Boolean).join(" · "),
      channelId: null,
      total: r.total,
      reachedInterview: r.reachedInterview,
      hired: r.hired,
      // VariantStat carries no rate at all (the server leaves the ratio to the
      // caller); computed on the same basis as the other two groups so the column
      // means one thing down its whole length.
      hireRatePct: hireRate(r.hired, r.total),
      spendCzk: null,
      spendUpdatedAt: null,
      costPerHireCzk: null,
    })),
  ];
}
