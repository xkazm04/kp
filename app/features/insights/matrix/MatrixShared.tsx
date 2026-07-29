import { useTranslations } from "next-intl";
import { columnStats, MATRIX_BANDS, STRONG_THRESHOLD, type ColumnStat } from "./matrixStats";

// koKeys: stable KoReason.key categories naming WHY a cell is blocked (MAT2);
// present only on blocked cells, localized by key via matrix.ko.* messages.
export type Cell = { score: number | null; blocked: boolean; koKeys?: string[] };

// Blocked/empty cells get a diagonal hatch so they read as "not applicable"
// without relying on the grey fill alone (color-independent legibility).
export const BLOCKED_CELL =
  "bg-stone-100 text-stone-400 [background-image:repeating-linear-gradient(45deg,#d6d3d1_0px,#d6d3d1_1px,transparent_1px,transparent_5px)]";

// diverging score scale: poor -> coral, fair -> amber, good/strong -> moss.
// Bands single-sourced in MATRIX_BANDS (matrix-stats.ts) — pick the highest band
// whose inclusive floor the score clears.
export function cellClass(c: Cell): string {
  if (c.blocked || c.score == null) return BLOCKED_CELL;
  const s = c.score;
  let cls: string = MATRIX_BANDS[0].cellClass;
  for (const b of MATRIX_BANDS) if (s >= b.min) cls = b.cellClass;
  return cls;
}

// Per-band fill for the mini-histogram, mirroring cellClass's diverging scale so
// the strip reads consistently with the grid below it. Same band order as columnStats' buckets.
const BAND_FILL = MATRIX_BANDS.map((b) => b.fill);

// MAT2 — a compact distribution strip under a position header: a 5-bar histogram
// of the column's non-blocked scores (bands match the legend) plus best / median /
// strong-count. Reads the column's pool fit at a glance: deep bench vs one hit.
export function ColumnStats({ scores }: { scores: number[] }) {
  const t = useTranslations("matrix");
  const s: ColumnStat = columnStats(scores);
  if (s.count === 0) {
    return <div className="mt-1 text-[10px] text-stone-400">{t("noFits")}</div>;
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
      <div className="mt-0.5 flex items-center gap-1 text-[10px] leading-none text-steel">
        <span className="nums font-semibold text-ink">{s.best}</span>
        <span className="text-stone-400">·</span>
        <span className="nums">~{s.median}</span>
        {s.strong > 0 ? <span className="nums text-moss">{`· ${s.strong}★`}</span> : null}
      </div>
    </div>
  );
}

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
