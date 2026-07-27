"use client";

import { useState } from "react";
import { RotateCcw, SlidersHorizontal } from "lucide-react";
import { useTranslations } from "next-intl";
import { isEarlyCareer, syncDraftToWeights, weightsDirty, type WeightVector } from "./MatchTypes";

const DIMS = ["skills", "career", "personal"] as const;
type Dim = (typeof DIMS)[number];

// Archetype-aware dimension labels — early-career profiles score on
// potential/foundation, not experience (mirrors MatchCard's Bar labels). Returns
// the `match.dims.*` catalog key per dimension; resolved via t() at the render site.
function dimKeysFor(archetype: string): Record<Dim, string> {
  return isEarlyCareer(archetype)
    ? { skills: "foundation", career: "potential", personal: "fit" }
    : { skills: "skills", career: "career", personal: "personal" };
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
  const t = useTranslations("match");
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<WeightVector>(weights);
  const dimKeys = dimKeysFor(archetype);
  const dimLabel = (d: Dim) => t(`dims.${dimKeys[d]}` as Parameters<typeof t>[0]);

  // bug-ui-scan-2026-07-09 (candidate-profile-job-matching #5): re-anchor the draft
  // sliders whenever the applied `weights` prop changes. After an "Apply re-rank" the
  // server renormalizes to sum-100 and the parent re-seeds `weights` from the response
  // (e.g. 60/20/20 -> 45/33/22); without this the sliders + labels kept showing the
  // stale pre-normalization draft and `dirty` stayed true, leaving the button falsely
  // enabled and the numbers disagreeing with the ranking beneath them. Done with the
  // adjust-state-during-render pattern (not an effect), so the re-anchor lands in the
  // same render pass as the new prop.
  const [anchor, setAnchor] = useState(weights);
  if (anchor !== weights) {
    setAnchor(weights);
    setDraft(syncDraftToWeights(weights));
  }

  // Did the recruiter move anything off the in-effect vector? (rounded — the
  // sliders step in whole percent.)
  const dirty = weightsDirty(draft, weights);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setDraft(syncDraftToWeights(weights)); // seed from the values actually in effect
          setOpen(true);
        }}
        className="focus-ring mt-3 inline-flex items-center gap-1.5 rounded-md border border-stone-200 bg-white px-3 py-1.5 text-sm font-semibold text-ink hover:border-coral/40"
      >
        <SlidersHorizontal size={14} className="text-coral" /> {t("weights.adjustWeighting")}
      </button>
    );
  }

  return (
    <div className="mt-3 rounded-md border border-stone-200 bg-paper p-3">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-meta uppercase tracking-wide text-steel">
          <SlidersHorizontal size={13} /> {t("weights.matchWeighting")}
        </p>
        <button type="button" onClick={() => setOpen(false)} className="focus-ring rounded px-2 py-0.5 text-sm font-semibold text-steel hover:text-ink">
          {t("weights.close")}
        </button>
      </div>
      <p className="mt-1 text-sm text-steel">{t("weights.intro")}</p>
      <div className="mt-2 space-y-2.5">
        {DIMS.map((d) => {
          const [lo, hi] = bounds[d] ?? [0.1, 0.6];
          return (
            <label key={d} className="block">
              <span className="flex items-center justify-between text-sm text-ink">
                <span className="font-semibold">{dimLabel(d)}</span>
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
                aria-label={t("weights.weightAria", { label: dimLabel(d) })}
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
          {busy ? t("weights.reranking") : t("weights.applyRerank")}
        </button>
        <button
          type="button"
          onClick={onReset}
          disabled={busy}
          className="focus-ring inline-flex h-8 items-center gap-1.5 rounded-md border border-stone-200 bg-white px-2.5 text-sm font-semibold text-steel hover:text-ink disabled:opacity-40"
        >
          <RotateCcw size={13} /> {t("weights.resetDefault")}
        </button>
      </div>
    </div>
  );
}
