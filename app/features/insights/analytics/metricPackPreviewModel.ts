// The metric pack PREVIEW's view model — pure, so the ordering and the "when does
// this pack clear" arithmetic are tested without React (MetricPackPreview.tsx is
// the wiring).
//
// The question the preview answers is the one a recruiter used to have to download
// the file to ask: "can I send this yet, and if not, when?". So the rows that BLOCK
// publication (thin / not measurable) come first, the summary counts what is
// publishable, and `earliestClear` is the date by which EVERY blocker clears at the
// recent pace: the latest of their dates, because the pack is only as ready as its
// last row. One undated blocker makes the whole pack undated; its own line says why
// (no pace, a window too narrow, a figure that does not accrue).
import type { Metric, MetricPack } from "@/app/_lib/metric-pack";

export type PreviewRow = Metric & { blocker: boolean };

export type MetricPackPreviewModel = {
  rows: PreviewRow[];
  summary: { publishable: number; total: number };
  /** Epoch ms by which every blocker clears, or null (no blockers, or one undated). */
  earliestClear: number | null;
  /** At least one blocker can never clear inside the chosen window at this pace. */
  windowTooNarrow: boolean;
  certifiable: boolean;
};

export function metricPackPreview(pack: MetricPack): MetricPackPreviewModel {
  const tagged = pack.metrics.map((m) => ({ ...m, blocker: m.status !== "measured" }));
  const blockers = tagged.filter((r) => r.blocker);
  const rows = [...blockers, ...tagged.filter((r) => !r.blocker)];
  let earliestClear: number | null = null;
  if (blockers.length > 0) {
    const dates = blockers.map((r) => r.need?.etaDate ?? null);
    earliestClear = dates.every((d): d is number => d != null) ? Math.max(...dates) : null;
  }
  return {
    rows,
    summary: { publishable: tagged.length - blockers.length, total: tagged.length },
    earliestClear,
    windowTooNarrow: blockers.some((r) => r.need?.reason === "window-too-narrow"),
    certifiable: pack.certifiable,
  };
}
