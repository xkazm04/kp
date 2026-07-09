"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, HelpCircle, Loader2, Scale, X } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  COMPLIANCE_REGIMES,
  DEFAULT_REGIME_ID,
  getRegime,
  REGIME_IDS,
  type RegimeId,
} from "@/app/_lib/compliance-regimes";
import { computeAdverseImpact, ADVERSE_IMPACT_MIN_COHORT, type GroupCount } from "@/app/_lib/adverse-impact";
import { Select } from "@/app/_components/Select";
import { TextArea } from "@/app/_components/TextArea";

// P1-1 — the recruiter-facing compliance posture, in the Decision Rules modal.
// Picks the workspace jurisdiction (drives the candidate AI-disclosure framing)
// and states HONESTLY what the platform does and does not do: it never claims
// statutory protected-class monitoring it can't perform, because it collects no
// demographic data. The four-fifths check below is a ready primitive that runs
// ENTIRELY in the browser on counts the recruiter pastes — nothing is stored.

function parseGroups(text: string): GroupCount[] {
  const out: GroupCount[] = [];
  for (const line of text.split("\n")) {
    const parts = line.split(",").map((p) => p.trim());
    if (parts.length < 3) continue;
    const [group, selRaw, totRaw] = parts;
    const selected = Number(selRaw);
    const total = Number(totRaw);
    if (!group || !Number.isFinite(selected) || !Number.isFinite(total)) continue;
    out.push({ group, selected, total });
  }
  return out;
}

export function ComplianceSection() {
  const t = useTranslations("decisions.compliance");
  const [jurisdiction, setJurisdiction] = useState<RegimeId>(DEFAULT_REGIME_ID);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [counts, setCounts] = useState("");
  // The EFFECTIVE retention window (derived server-side from KP_CONSENT_TTL_DAYS)
  // so the posture line states the enforced number, not a hardcoded "12 months"
  // (REC-08). Default 12 mirrors the server default of 365 days.
  const [retentionMonths, setRetentionMonths] = useState(12);

  useEffect(() => {
    fetch("/api/decisions/config")
      .then((r) => r.json())
      .then((p: { configs?: { compliance?: { jurisdiction?: unknown } } }) => {
        const j = p?.configs?.compliance?.jurisdiction;
        if (typeof j === "string" && (REGIME_IDS as readonly string[]).includes(j)) setJurisdiction(j as RegimeId);
      })
      .catch(() => {});
    fetch("/api/compliance")
      .then((r) => r.json())
      .then((d: { consentRetentionMonths?: unknown }) => {
        if (typeof d?.consentRetentionMonths === "number" && d.consentRetentionMonths >= 1) {
          setRetentionMonths(d.consentRetentionMonths);
        }
      })
      .catch(() => {});
  }, []);

  const pick = async (j: RegimeId) => {
    setJurisdiction(j); // optimistic
    setSaving(true);
    setNote(null);
    try {
      const r = await fetch("/api/decisions/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phase: "compliance", config: { jurisdiction: j } }),
      });
      if (!r.ok) throw new Error();
      setNote(t("saved"));
    } catch {
      setNote(t("saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const regime = getRegime(jurisdiction);
  const standard = regime.adverseImpactStandard ?? t("standardFallback");

  const groups = useMemo(() => parseGroups(counts), [counts]);
  const impact = useMemo(() => (groups.length >= 2 ? computeAdverseImpact(groups) : null), [groups]);

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
            size="sm"
            className="w-full"
            options={Object.values(COMPLIANCE_REGIMES).map((r) => ({ value: r.id, label: t(`jur.${r.id}` as Parameters<typeof t>[0]) }))}
          />
          {saving ? <Loader2 size={15} className="shrink-0 animate-spin text-steel" /> : null}
          {note ? (
            <span role="status" aria-live="polite" className="shrink-0 text-meta text-steel">
              {note}
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

      {/* Four-fifths check — pure, in-browser, nothing stored. */}
      <details className="rounded-md border border-stone-200 bg-white p-3">
        <summary className="cursor-pointer text-sm font-semibold text-ink">{t("aiCheckTitle")}</summary>
        <p className="mt-2 text-sm text-steel">{t("aiCheckIntro")}</p>
        <TextArea
          value={counts}
          onChange={(e) => setCounts(e.target.value)}
          rows={4}
          spellCheck={false}
          placeholder={t("aiCheckPlaceholder")}
          sizeVariant="sm"
          className="mt-2 font-mono"
        />
        <p className="mt-1 text-meta text-steel">{t("aiCheckPrivacy")}</p>
        {impact ? (
          <div className="mt-3">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-meta uppercase tracking-wide text-steel">
                  <th className="py-1 pr-2 font-medium">{t("colGroup")}</th>
                  <th className="py-1 pr-2 font-medium">{t("colRate")}</th>
                  <th className="py-1 pr-2 font-medium">{t("colRatio")}</th>
                  <th className="py-1 font-medium">{t("colStatus")}</th>
                </tr>
              </thead>
              <tbody>
                {impact.groups.map((g) => (
                  <tr key={g.group} className="border-t border-stone-100">
                    <td className="py-1 pr-2 text-ink">{g.group}</td>
                    <td className="nums py-1 pr-2 text-steel">
                      {(g.selectionRate * 100).toFixed(0)}% <span className="text-stone-400">({g.selected}/{g.total})</span>
                    </td>
                    <td className="nums py-1 pr-2 text-steel">{g.impactRatio === null ? "—" : g.impactRatio.toFixed(2)}</td>
                    <td className="py-1">
                      {g.isReference ? (
                        <span className="text-steel">{t("statusReference")}</span>
                      ) : g.impactRatio === null ? (
                        <span className="text-stone-400">{t("statusNa")}</span>
                      ) : g.adverseImpact ? (
                        <span className="font-semibold text-coral">{t("statusAdverse")}</span>
                      ) : (
                        <span className="text-moss">{t("statusOk")}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {/* Three states, not two. "Insufficient sample" is NOT "no adverse impact":
                below ADVERSE_IMPACT_MIN_COHORT the compute forces anyAdverseImpact=false,
                so a binary green/red readout would render a legally-loaded false clean. */}
            <p
              className={`mt-2 flex items-center gap-1.5 text-sm font-medium ${
                !impact.reliable ? "text-steel" : impact.anyAdverseImpact ? "text-coral" : "text-moss"
              }`}
            >
              {!impact.reliable ? (
                <HelpCircle size={14} />
              ) : impact.anyAdverseImpact ? (
                <AlertTriangle size={14} />
              ) : (
                <Check size={14} />
              )}
              {!impact.reliable
                ? t("insufficientSample", { min: ADVERSE_IMPACT_MIN_COHORT })
                : impact.anyAdverseImpact
                  ? t("anyAdverse")
                  : t("noAdverse")}
            </p>
          </div>
        ) : (
          <p className="mt-2 text-meta text-steel">{t("aiCheckHint")}</p>
        )}
      </details>
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
