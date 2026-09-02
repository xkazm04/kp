import { memo } from "react";
import { useTranslations } from "next-intl";
import { MATRIX_BANDS, STRONG_THRESHOLD, type ColumnStat } from "./matrixStats";
import { BLOCKED_CELL } from "./matrixCellClass";

// Cell, BLOCKED_CELL and cellClass moved to the JSX-free `matrixCellClass.ts` so they
// are reachable from the unit runner; re-exported here because this module has been
// their import site since the split out of MatrixTab.tsx.
export { BLOCKED_CELL, cellClass } from "./matrixCellClass";
export type { Cell } from "./matrixCellClass";

// Per-band fill for the mini-histogram, mirroring cellClass's diverging scale so
// the strip reads consistently with the grid below it. Same band order as columnStats' buckets.
const BAND_FILL = MATRIX_BANDS.map((b) => b.fill);

// MAT2 — a compact distribution strip under a position header: a 5-bar histogram
// of the column's non-blocked scores (bands match the legend) plus best / median /
// strong-count. Reads the column's pool fit at a glance: deep bench vs one hit.
//
// grid-chrome-holds-the-floor: this used to run the columnStats pass in its own body,
// once per visible column, on EVERY render of the header row — a sort, a median and five
// buckets over the whole candidate pool for a number that only changes when the data
// does. The stat now arrives precomputed from the hook's memo chain, and the component
// is a memo boundary so the strip does not rebuild with the header around it.
function ColumnStatsInner({ stat: s }: { stat: ColumnStat }) {
  const t = useTranslations("matrix");
  if (s.count === 0) {
    return <div className="mt-1 text-xs text-stone-400">{t("noFits")}</div>;
  }
  const maxBucket = Math.max(...s.buckets, 1);
  return (
    <div
      className="mt-1"
      title={t("colStatsTitle", { count: s.count, best: s.best ?? 0, median: s.median ?? 0, strong: s.strong, threshold: STRONG_THRESHOLD })}
    >
      <div className="flex h-5 items-end gap-px" aria-hidden>
        {s.buckets.map((n, i) => (
          <span
            key={i}
            className={`w-1.5 rounded-sm ${n > 0 ? BAND_FILL[i] : "bg-stone-100"}`}
            style={{ height: `${Math.max(2, Math.round((n / maxBucket) * 20))}px` }}
          />
        ))}
      </div>
      <div className="mt-0.5 flex items-center gap-1 text-xs leading-none text-steel">
        <span className="nums font-semibold text-ink">{s.best}</span>
        <span className="text-stone-400">·</span>
        <span className="nums">~{s.median}</span>
        {s.strong > 0 ? <span className="nums text-moss">{`· ${s.strong}★`}</span> : null}
      </div>
    </div>
  );
}

export const ColumnStats = memo(ColumnStatsInner);

export function MatrixLegend() {
  const t = useTranslations("matrix");
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm text-steel">
      <span className="font-semibold uppercase tracking-wide">{t("legendMatch")}</span>
      {[
        ...MATRIX_BANDS.map((b) => [b.cellClass, b.label] as const),
        [BLOCKED_CELL, "blocked"] as const,
      ].map(([cls, label]) => (
        <span key={label} className="inline-flex items-center gap-1">
          <span className={`grid h-5 w-6 place-items-center rounded ${cls} text-sm font-semibold`}>{label === "blocked" ? "–" : ""}</span>
          {label === "blocked" ? t("blocked") : label}
        </span>
      ))}
      <span className="inline-flex items-center gap-1">
        <span className="h-4 w-4 rounded ring-2 ring-inset ring-ink/50" /> {t("inPipeline")}
      </span>
    </div>
  );
}
