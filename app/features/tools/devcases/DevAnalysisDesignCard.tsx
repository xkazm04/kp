"use client";

// D3 — the designed role + assignment (human gate), split out of
// DevAnalysisView.tsx.
import { Check, ClipboardList, Lock, ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { timeboxHoursForDisplay } from "@/app/_lib/devcase-timebox";
import { BTN_AFFIRM, PANEL } from "@/app/_components/ui/recipes";
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
  const t = useTranslations("devcase.studio.design");
  return (
    <div className="space-y-4">
      <div className={`${PANEL} p-4`}>
        <div className="mb-2 flex items-center gap-2">
          <span className="text-meta uppercase tracking-wide text-steel">{t("role")}</span>
          <ProvenanceStrip className="ml-auto" perStepSources={design.perStepSources} source={design.source} />
        </div>
        <p className="font-serif text-h3 text-ink">{design.role?.title}</p>
        <p className="text-sm uppercase text-steel">{design.role?.seniority}</p>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          <MiniList title={t("mustHaves")} items={design.role?.mustHaves ?? []} />
          <MiniList title={t("responsibilities")} items={design.role?.responsibilities ?? []} />
        </div>
      </div>

      <div className={`${PANEL} p-4`}>
        <div className="mb-2 flex items-center gap-2">
          <ClipboardList size={14} className="text-steel" />
          <span className="text-meta uppercase tracking-wide text-steel">{t("assignment")}</span>
          <span className="ml-auto text-micro text-steel">
            {t("timebox", { hours: timeboxHoursForDisplay(design.case?.timeboxHours) })}
          </span>
        </div>
        <p className="font-semibold text-ink">{design.case?.title}</p>
        <p className="mt-1 text-base text-ink">{design.case?.brief}</p>
        {(design.case?.tasks ?? []).length ? (
          <ol className="mt-2 list-decimal space-y-0.5 pl-4 text-sm text-ink">
            {(design.case?.tasks ?? []).map((task, i) => <li key={i}>{task}</li>)}
          </ol>
        ) : null}

        {(design.case?.coverProbes ?? []).length ? (
          <div className="mt-3 rounded-md border border-amber-200 bg-amber-50/60 p-2.5">
            <p className="flex items-center gap-1 text-micro font-semibold uppercase tracking-wide text-amber-700">
              <Lock size={11} /> {t("covertProbes")}
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
            <span className="inline-flex items-center gap-1 text-base font-semibold text-moss"><Check size={16} /> {t("approved")}</span>
          ) : (
            <button type="button" onClick={approve} disabled={approving}
              className={`${BTN_AFFIRM} h-9 px-3 text-base`}>
              <ShieldCheck size={15} /> {approving ? t("approving") : t("approve")}
            </button>
          )}
          <span className="text-micro text-steel">{t("humanGate")}</span>
        </div>
      </div>
    </div>
  );
}
