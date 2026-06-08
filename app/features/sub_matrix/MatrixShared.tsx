import { columnStats, STRONG_THRESHOLD, type ColumnStat } from "./matrix-stats";

export type Cell = { score: number | null; blocked: boolean };

// Blocked/empty cells get a diagonal hatch so they read as "not applicable"
// without relying on the grey fill alone (color-independent legibility).
export const BLOCKED_CELL =
  "bg-stone-100 text-stone-400 [background-image:repeating-linear-gradient(45deg,#d6d3d1_0px,#d6d3d1_1px,transparent_1px,transparent_5px)]";

// diverging score scale: poor -> coral, fair -> amber, good/strong -> moss
export function cellClass(c: Cell): string {
  if (c.blocked || c.score == null) return BLOCKED_CELL;
  const s = c.score;
  if (s < 45) return "bg-coral/15 text-coral";
  if (s < 60) return "bg-amber-100 text-amber-700";
  if (s < 72) return "bg-moss/20 text-moss";
  if (s < 85) return "bg-moss/40 text-ink";
  return "bg-moss/70 text-white";
}

// Per-band fill for the mini-histogram, mirroring cellClass's diverging scale so
// the strip reads consistently with the grid below it.
const BAND_FILL = ["bg-coral/40", "bg-amber-300", "bg-moss/40", "bg-moss/60", "bg-moss/80"] as const;

// MAT2 — a compact distribution strip under a position header: a 5-bar histogram
// of the column's non-blocked scores (bands match the legend) plus best / median /
// strong-count. Reads the column's pool fit at a glance: deep bench vs one hit.
export function ColumnStats({ scores }: { scores: number[] }) {
  const s: ColumnStat = columnStats(scores);
  if (s.count === 0) {
    return <div className="mt-1 text-[10px] text-stone-400">no fits</div>;
  }
  const maxBucket = Math.max(...s.buckets, 1);
  return (
    <div
      className="mt-1"
      title={`${s.count} scored · best ${s.best} · median ${s.median} · ${s.strong} strong (≥${STRONG_THRESHOLD})`}
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
        {s.strong > 0 ? <span className="nums text-moss">· {s.strong}★</span> : null}
      </div>
    </div>
  );
}

export function MatrixLegend() {
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm text-steel">
      <span className="font-semibold uppercase tracking-wide">Match</span>
      {[
        ["bg-coral/15 text-coral", "<45"],
        ["bg-amber-100 text-amber-700", "45–59"],
        ["bg-moss/20 text-moss", "60–71"],
        ["bg-moss/40 text-ink", "72–84"],
        ["bg-moss/70 text-white", "85+"],
        [BLOCKED_CELL, "blocked"],
      ].map(([cls, label]) => (
        <span key={label} className="inline-flex items-center gap-1">
          <span className={`grid h-5 w-6 place-items-center rounded ${cls} text-sm font-semibold`}>{label === "blocked" ? "–" : ""}</span>
          {label}
        </span>
      ))}
      <span className="inline-flex items-center gap-1">
        <span className="h-4 w-4 rounded ring-2 ring-inset ring-ink/50" /> in pipeline
      </span>
    </div>
  );
}
