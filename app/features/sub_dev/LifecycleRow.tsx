"use client";

import { useState } from "react";
import { Archive, ShieldCheck } from "lucide-react";
import { LIFECYCLE_STEPS, STAGE_LABEL } from "./DevTypes";
import type { Lifecycle } from "./DevTypes";

export function LifecycleRow({ lc, onApprove, onChanged }: { lc: Lifecycle; onApprove: () => void; onChanged?: () => void }) {
  const mapped = lc.stage === "awaiting_approval" ? "designed" : lc.stage === "published" ? "collecting" : lc.stage;
  const idx = LIFECYCLE_STEPS.indexOf(mapped);
  const awaiting = lc.stage === "awaiting_approval";
  const done = lc.stage === "promoted";
  // W5-3 — human-gated close-out. Offered once the case is live (collecting or
  // beyond): wraps up non-promoted submitters with a courteous comm, closes the
  // postings (apply page + webhook answer honestly) and flips the lifecycle to
  // its terminal stage instead of parking at `promoted` forever.
  const closable = ["published", "collecting", "ranked", "promoted"].includes(lc.stage);
  const [closing, setClosing] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);
  const closeCase = async () => {
    if (closing) return;
    if (typeof window !== "undefined" && !window.confirm("Close this case? Non-promoted submitters get a wrap-up note and the apply link stops accepting submissions.")) return;
    setClosing(true);
    setCloseError(null);
    try {
      const r = await fetch(`/api/devcase/lifecycle/${encodeURIComponent(lc.id)}/close`, { method: "POST" });
      const payload = (await r.json().catch(() => null)) as { error?: string } | null;
      if (!r.ok) throw new Error(payload?.error ?? "Close failed.");
      onChanged?.();
    } catch (caught) {
      setCloseError(caught instanceof Error ? caught.message : "Close failed.");
    } finally {
      setClosing(false);
    }
  };
  // Describe the dot-rail for screen readers, since the steps are otherwise
  // conveyed purely by color/position.
  const railLabel = `Lifecycle progress — ${LIFECYCLE_STEPS.map(
    (s, i) => `${s}: ${i < idx ? "done" : i === idx ? "current" : "upcoming"}`
  ).join(", ")}`;
  return (
    <div className="animate-fade-in rounded-lg border border-stone-200 bg-white p-3 shadow-panel transition-shadow motion-reduce:animate-none hover:shadow-lg">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-base font-semibold text-ink">{lc.title || "Role"}</span>
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
        {closable ? (
          <button
            type="button"
            onClick={closeCase}
            disabled={closing}
            title="Wrap up non-promoted submitters and stop the apply link"
            className="focus-ring inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-stone-200 bg-white px-2.5 text-micro font-semibold text-steel hover:border-coral/40 hover:text-ink disabled:opacity-50"
          >
            <Archive size={12} /> {closing ? "Closing…" : "Close case"}
          </button>
        ) : null}
      </div>
      {closeError ? (
        <p role="alert" className="mt-1 text-micro text-red-700">
          {closeError}
        </p>
      ) : null}
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
