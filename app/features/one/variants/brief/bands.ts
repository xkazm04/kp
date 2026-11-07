// The Brief's front page as data — PURE, so node:test pins it without React.
//
// The attention read decides the page: the first need (the greeting's own priority)
// is the LEAD story; every other bucket with news gets a BAND; buckets with nothing to
// say collapse into ONE quiet line. A read that did not land draws no bands at all
// (unknown is not "nothing new" — attention.ts's own rule), only the regular columns.
//
// A band never draws a panel of its own: the region holds ≤ 3 views (types.ts
// MAX_PANELS), so a band asks (its chips go through the conductor) and, when the view
// that answers it is already on the page, points at it instead of drawing a second one.
import type { AttentionCounts } from "@/app/_lib/attention";
import { NEED_ORDER, NEED_PANEL, type NeedKey } from "../../engine/greeting";
import type { ChipId, PanelInstance } from "../../types";

/** The ask-chips under each band (2-3): its own question first, then the nearest ones. */
export const BAND_CHIPS: Record<NeedKey, readonly ChipId[]> = {
  decisions: ["decisions", "needs"],
  pipeline: ["stalled", "pipeline", "funnel"],
  channels: ["arrivals", "pipeline", "outbox"],
  schedule: ["interviews", "needs"],
  jobs: ["drafts", "funnel"],
};

/** Questions with no attention bucket behind them: always on the page, never "news". */
export const COLUMN_CHIPS: readonly ChipId[] = ["funnel", "outbox", "pipeline"];

export type Band = { key: NeedKey; count: number; chips: readonly ChipId[] };

export type FrontPage =
  | { state: "unknown" }
  | { state: "read"; lead: NeedKey | null; bands: Band[]; quiet: NeedKey[] };

export function frontPage(attention: AttentionCounts | null): FrontPage {
  if (!attention) return { state: "unknown" };
  const has = (k: NeedKey) => Number.isFinite(attention[k]) && attention[k] > 0;
  const waiting = NEED_ORDER.filter(has);
  const lead = waiting[0] ?? null;
  return {
    state: "read",
    lead,
    bands: waiting.filter((k) => k !== lead).map((key) => ({ key, count: attention[key], chips: BAND_CHIPS[key] })),
    quiet: NEED_ORDER.filter((k) => !has(k)),
  };
}

/** The view on the page that answers a bucket (same kind, and the bucket's filter when it
 *  has one — a role-scoped slice of the same filter still answers it), or null. */
export function answeringPanel(key: NeedKey, panels: readonly PanelInstance[]): PanelInstance | null {
  const spec = NEED_PANEL[key];
  return (
    panels.find((p) => p.kind === spec.panel && Object.entries(spec.params ?? {}).every(([k, v]) => p.params[k] === v)) ?? null
  );
}
