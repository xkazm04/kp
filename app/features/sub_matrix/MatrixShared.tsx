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

export function MatrixLegend() {
  return (
    <div className="flex flex-wrap items-center gap-3 text-[11px] text-steel">
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
          <span className={`grid h-5 w-6 place-items-center rounded ${cls} text-[9px] font-semibold`}>{label === "blocked" ? "–" : ""}</span>
          {label}
        </span>
      ))}
      <span className="inline-flex items-center gap-1">
        <span className="h-4 w-4 rounded ring-2 ring-inset ring-ink/50" /> in pipeline
      </span>
    </div>
  );
}
