"use client";

// D3 — the designed role + assignment (human gate), split out of
// DevAnalysisView.tsx.
import { Check, ClipboardList, Lock, ShieldCheck } from "lucide-react";
import { timeboxHoursForDisplay } from "@/app/_lib/devcase-timebox";
import { ProvenanceStrip } from "./DevProvenanceStrip";
import { MiniList, ProbeRow, RubricChip } from "./DevShared";
import type { Design } from "./DevTypes";

export function DevAnalysisDesignCard({
  design,
  approve,
  approving,
  approvedId,
}: {
  design: Design;
  approve: () => void;
  approving: boolean;
  approvedId: string | null;
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-stone-200 bg-white p-4 shadow-panel">
        <div className="mb-2 flex items-center gap-2">
          <span className="text-meta uppercase tracking-wide text-steel">Role</span>
          <ProvenanceStrip className="ml-auto" perStepSources={design.perStepSources} source={design.source} />
        </div>
        <p className="font-serif text-h3 text-ink">{design.role?.title}</p>
        <p className="text-sm uppercase text-steel">{design.role?.seniority}</p>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          <MiniList title="Must-haves" items={design.role?.mustHaves ?? []} />
          <MiniList title="Responsibilities" items={design.role?.responsibilities ?? []} />
        </div>
      </div>

      <div className="rounded-lg border border-stone-200 bg-white p-4 shadow-panel">
        <div className="mb-2 flex items-center gap-2">
          <ClipboardList size={14} className="text-steel" />
          <span className="text-meta uppercase tracking-wide text-steel">Assignment</span>
          <span className="ml-auto text-micro text-steel">~{timeboxHoursForDisplay(design.case?.timeboxHours)}h</span>
        </div>
        <p className="font-semibold text-ink">{design.case?.title}</p>
        <p className="mt-1 text-base text-ink">{design.case?.brief}</p>
        {(design.case?.tasks ?? []).length ? (
          <ol className="mt-2 list-decimal space-y-0.5 pl-4 text-sm text-ink">
            {(design.case?.tasks ?? []).map((t, i) => <li key={i}>{t}</li>)}
          </ol>
        ) : null}

        {(design.case?.coverProbes ?? []).length ? (
          <div className="mt-3 rounded-md border border-amber-200 bg-amber-50/60 p-2.5">
            <p className="flex items-center gap-1 text-micro font-semibold uppercase tracking-wide text-amber-700">
              <Lock size={11} /> Covert probes — internal, hidden from the candidate
            </p>
            <ul className="mt-1 space-y-1">
              {(design.case?.coverProbes ?? []).map((p, i) => (
                <li key={i} className="text-micro text-ink">
                  <ProbeRow probe={p} tone="amber" />
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {(design.case?.rubricDimensions ?? []).length ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {(design.case?.rubricDimensions ?? []).map((d) => (
              <RubricChip key={d.name} dim={d} tone="paper" />
            ))}
          </div>
        ) : null}

        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-stone-100 pt-3">
          {approvedId ? (
            <span className="inline-flex items-center gap-1 text-base font-semibold text-moss"><Check size={16} /> Approved</span>
          ) : (
            <button type="button" onClick={approve} disabled={approving}
              className="focus-ring inline-flex h-9 items-center gap-1.5 rounded-md bg-moss px-3 text-base font-semibold text-white hover:opacity-90 disabled:opacity-50">
              <ShieldCheck size={15} /> {approving ? "Approving…" : "Approve assignment"}
            </button>
          )}
          <span className="text-micro text-steel">Human gate — review the probes, then approve to save it.</span>
        </div>
      </div>
    </div>
  );
}
