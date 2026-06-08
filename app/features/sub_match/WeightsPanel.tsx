"use client";

import { useState } from "react";
import { RotateCcw, SlidersHorizontal } from "lucide-react";
import { isEarlyCareer, type WeightVector } from "./MatchTypes";

const DIMS = ["skills", "career", "personal"] as const;
type Dim = (typeof DIMS)[number];

// Archetype-aware labels — early-career profiles score on potential/foundation,
// not experience (mirrors MatchCard's Bar labels).
function labelsFor(archetype: string): Record<Dim, string> {
  return isEarlyCareer(archetype)
    ? { skills: "Foundation", career: "Potential", personal: "Fit" }
    : { skills: "Skills", career: "Career", personal: "Personal" };
}

// Recruiter-adjustable match weighting (MAT1). The Python scorer always carried a
// bounded weight vector but only auto-proposed it in Decisions — here the recruiter
// drives it. Each dimension is clamped to the archetype's [min,max]; the server
// renormalizes to sum 100% (and re-clamps), so the panel can't push an unfair or
// non-summing vector. Re-seeded from the response after each apply.
export function WeightsPanel({
  weights,
  bounds,
  archetype,
  busy,
  onApply,
  onReset,
}: {
  weights: WeightVector;
  bounds: Record<string, [number, number]>;
  archetype: string;
  busy: boolean;
  onApply: (w: WeightVector) => void;
  onReset: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<WeightVector>(weights);
  const labels = labelsFor(archetype);

  // Did the recruiter move anything off the in-effect vector? (rounded — the
  // sliders step in whole percent.)
  const dirty = DIMS.some((d) => Math.round(draft[d] * 100) !== Math.round(weights[d] * 100));

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setDraft(weights); // seed from the values actually in effect
          setOpen(true);
        }}
        className="focus-ring mt-3 inline-flex items-center gap-1.5 rounded-md border border-stone-200 bg-white px-3 py-1.5 text-sm font-semibold text-ink hover:border-coral/40"
      >
        <SlidersHorizontal size={14} className="text-coral" /> Adjust weighting
      </button>
    );
  }

  return (
    <div className="mt-3 rounded-md border border-stone-200 bg-paper p-3">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-meta uppercase tracking-wide text-steel">
          <SlidersHorizontal size={13} /> Match weighting
        </p>
        <button type="button" onClick={() => setOpen(false)} className="focus-ring rounded px-2 py-0.5 text-sm font-semibold text-steel hover:text-ink">
          Close
        </button>
      </div>
      <p className="mt-1 text-sm text-steel">
        Tune how much each dimension counts for this candidate. Bounded to keep ranking fair; normalized to 100% on apply.
      </p>
      <div className="mt-2 space-y-2.5">
        {DIMS.map((d) => {
          const [lo, hi] = bounds[d] ?? [0.1, 0.6];
          return (
            <label key={d} className="block">
              <span className="flex items-center justify-between text-sm text-ink">
                <span className="font-semibold">{labels[d]}</span>
                <span className="nums text-steel">{Math.round(draft[d] * 100)}%</span>
              </span>
              <input
                type="range"
                min={Math.round(lo * 100)}
                max={Math.round(hi * 100)}
                step={1}
                value={Math.round(draft[d] * 100)}
                disabled={busy}
                onChange={(e) => setDraft((s) => ({ ...s, [d]: Number(e.target.value) / 100 }))}
                className="mt-1 w-full accent-coral"
                aria-label={`${labels[d]} weight`}
              />
            </label>
          );
        })}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => onApply(draft)}
          disabled={busy || !dirty}
          className="focus-ring inline-flex h-8 items-center rounded-md bg-ink px-3 text-sm font-semibold text-white hover:bg-ink/90 disabled:opacity-40"
        >
          {busy ? "Re-ranking…" : "Apply & re-rank"}
        </button>
        <button
          type="button"
          onClick={onReset}
          disabled={busy}
          className="focus-ring inline-flex h-8 items-center gap-1.5 rounded-md border border-stone-200 bg-white px-2.5 text-sm font-semibold text-steel hover:text-ink disabled:opacity-40"
        >
          <RotateCcw size={13} /> Reset to default
        </button>
      </div>
    </div>
  );
}
