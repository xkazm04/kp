"use client";

import { ShieldCheck } from "lucide-react";
import { LIFECYCLE_STEPS, STAGE_LABEL } from "./DevTypes";
import type { Lifecycle } from "./DevTypes";

export function LifecycleRow({ lc, onApprove }: { lc: Lifecycle; onApprove: () => void }) {
  const mapped = lc.stage === "awaiting_approval" ? "designed" : lc.stage === "published" ? "collecting" : lc.stage;
  const idx = LIFECYCLE_STEPS.indexOf(mapped);
  const awaiting = lc.stage === "awaiting_approval";
  const done = lc.stage === "promoted";
  // Describe the dot-rail for screen readers, since the steps are otherwise
  // conveyed purely by color/position.
  const railLabel = `Lifecycle progress — ${LIFECYCLE_STEPS.map(
    (s, i) => `${s}: ${i < idx ? "done" : i === idx ? "current" : "upcoming"}`
  ).join(", ")}`;
  return (
    <div className="animate-fade-in rounded-lg border border-stone-200 bg-white p-3 shadow-panel transition-shadow motion-reduce:animate-none hover:shadow-lg">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">{lc.title || "Role"}</span>
        <span
          className={`rounded-full px-2 py-0.5 text-micro font-semibold uppercase ${
            awaiting ? "bg-amber-100 text-amber-700" : done ? "bg-moss/15 text-moss" : "bg-paper text-steel"
          }`}
        >
          {STAGE_LABEL[lc.stage] ?? lc.stage}
        </span>
        {awaiting ? (
          <button
            type="button"
            onClick={onApprove}
            className="focus-ring inline-flex h-7 shrink-0 items-center gap-1 rounded-md bg-moss px-2.5 text-micro font-semibold text-white hover:opacity-90"
          >
            <ShieldCheck size={12} /> Approve
          </button>
        ) : null}
      </div>
      <div className="mt-2 flex items-center" role="img" aria-label={railLabel}>
        {LIFECYCLE_STEPS.map((s, i) => (
          <div key={s} aria-hidden className={`flex items-center ${i < LIFECYCLE_STEPS.length - 1 ? "flex-1" : ""}`}>
            <span className={`h-2 w-2 shrink-0 rounded-full ${i <= idx ? "bg-coral" : "bg-stone-200"}`} title={s} />
            {i < LIFECYCLE_STEPS.length - 1 ? <span className={`h-0.5 flex-1 ${i < idx ? "bg-coral/40" : "bg-stone-200"}`} /> : null}
          </div>
        ))}
      </div>
      <p className="mt-1.5 text-micro text-steel">{lc.detail}</p>
    </div>
  );
}
