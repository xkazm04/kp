"use client";

import { Check, Loader2, Scale, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { COMPLIANCE_REGIMES, type RegimeId } from "@/app/_lib/compliance-regimes";
import { Select } from "@/app/_components/Select";
import { useComplianceJurisdiction } from "./decisionsComplianceState";
import { DecisionsComplianceImpactCheck } from "./DecisionsComplianceImpactCheck";

// P1-1 — the recruiter-facing compliance posture, in the Decision Rules modal.
// Picks the workspace jurisdiction (drives the candidate AI-disclosure framing)
// and states HONESTLY what the platform does and does not do: it never claims
// statutory protected-class monitoring it can't perform, because it collects no
// demographic data. The four-fifths check (DecisionsComplianceImpactCheck) is a
// ready primitive that runs ENTIRELY in the browser on counts the recruiter
// pastes — nothing is stored. Jurisdiction picker state lives in
// decisionsComplianceState.ts — both split out to keep this file under 200 lines.

export function ComplianceSection() {
  const t = useTranslations("decisions.compliance");
  const { jurisdiction, saving, saveState, retentionMonths, pick, regime, standard } = useComplianceJurisdiction(t("standardFallback"));

  return (
    <div className="space-y-4 border-t border-stone-200 pt-4">
      <div>
        <p className="flex items-center gap-1.5 text-sm font-semibold text-ink">
          <Scale size={14} className="text-steel" /> {t("title")}
        </p>
        <p className="mt-0.5 text-sm text-steel">{t("subtitle")}</p>
      </div>

      {/* Jurisdiction picker — auto-saves; drives the candidate disclosure. */}
      <label className="block">
        <span className="mb-1 block text-sm text-steel">{t("jurisdictionLabel")}</span>
        <div className="flex items-center gap-2">
          <Select
            ariaLabel={t("jurisdictionLabel")}
            value={jurisdiction}
            onChange={(v) => pick(v as RegimeId)}
            sizeVariant="sm"
            className="w-full"
            disabled={saving}
            options={Object.values(COMPLIANCE_REGIMES).map((r) => ({ value: r.id, label: t(`jur.${r.id}` as Parameters<typeof t>[0]) }))}
          />
          {saving ? <Loader2 size={15} className="shrink-0 animate-spin text-steel" /> : null}
          {saveState ? (
            <span
              role={saveState === "failed" ? "alert" : "status"}
              aria-live={saveState === "failed" ? "assertive" : "polite"}
              className={`shrink-0 text-meta ${saveState === "failed" ? "font-semibold text-coral" : "text-steel"}`}
            >
              {saveState === "failed" ? t("saveFailed") : t("saved")}
            </span>
          ) : null}
        </div>
      </label>

      {/* The active regime's named instruments (proper nouns from the catalog). */}
      <dl className="grid grid-cols-1 gap-x-4 gap-y-1 rounded-md bg-paper p-3 text-sm sm:grid-cols-2">
        <Field label={t("regimeDataLaw")} value={regime.dataLaw} />
        <Field label={t("regimeOversight")} value={regime.oversightBasis} />
        <Field label={t("regimeAntiDiscrimination")} value={regime.antiDiscrimination} />
        <Field label={t("regimeAdverseStandard")} value={regime.adverseImpactStandard ?? t("regimeAdverseNone")} />
      </dl>

      {/* Honest posture: covered vs. the named ceilings. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <p className="text-meta font-semibold uppercase tracking-wide text-moss">{t("postureCoveredTitle")}</p>
          <ul className="mt-1 space-y-1">
            {[
              t("covered1", { oversight: regime.oversightBasis }),
              t("covered2"),
              t("covered3"),
              t("covered4"),
              t("covered5", { dataLaw: regime.dataLaw, months: retentionMonths }),
            ].map((line, i) => (
              <li key={i} className="flex gap-1.5 text-sm text-steel">
                <Check size={14} className="mt-0.5 shrink-0 text-moss" /> <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="text-meta font-semibold uppercase tracking-wide text-coral">{t("postureCeilingTitle")}</p>
          <ul className="mt-1 space-y-1">
            {[t("ceiling1", { standard }), t("ceiling2")].map((line, i) => (
              <li key={i} className="flex gap-1.5 text-sm text-steel">
                <X size={14} className="mt-0.5 shrink-0 text-coral" /> <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <DecisionsComplianceImpactCheck />
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-meta uppercase tracking-wide text-steel">{label}</dt>
      <dd className="text-ink">{value}</dd>
    </div>
  );
}
