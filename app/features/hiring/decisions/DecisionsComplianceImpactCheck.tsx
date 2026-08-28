"use client";

// The four-fifths adverse-impact check — pure, in-browser, nothing stored.
// Split out of DecisionsComplianceSection so that component stays under 200
// lines. Parses pasted group counts and renders the ratio table + verdict.
import { useMemo, useState } from "react";
import { AlertTriangle, Check, HelpCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { computeAdverseImpact, parseGroupCounts, ADVERSE_IMPACT_MIN_COHORT } from "@/app/_lib/adverse-impact";
import { TextArea } from "@/app/_components/TextArea";

export function DecisionsComplianceImpactCheck() {
  const t = useTranslations("decisions.compliance");
  const [counts, setCounts] = useState("");
  const parsed = useMemo(() => parseGroupCounts(counts), [counts]);
  const impact = useMemo(() => (parsed.groups.length >= 2 ? computeAdverseImpact(parsed.groups) : null), [parsed]);

  return (
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
      {/* Malformed rows are made VISIBLE, not silently dropped (finding SD-4): a
          four-fifths verdict computed on a silently-reduced set can flip which
          group is the reference. Announce which lines were ignored. */}
      {/* role=status + aria-live=polite, the pairing the sibling ComplianceSection
          uses (it switches BOTH together: alert+assertive on a failed save,
          status+polite otherwise). This carried role="alert" — implicitly assertive
          — with an explicit aria-live="polite" contradicting it, so the markup asked
          for two different urgencies for a typed-input parse notice that is not an
          interruption. Polite is the intent; now only one attribute says so. */}
      {parsed.malformedRows.length > 0 ? (
        <p role="status" aria-live="polite" className="mt-2 flex items-start gap-1.5 text-meta font-medium text-coral">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          <span>
            {t("parseIgnored", {
              read: parsed.groups.length,
              total: parsed.nonBlankRows,
              ignored: parsed.malformedRows.length,
              rows: parsed.malformedRows.join(", "),
            })}
          </span>
        </p>
      ) : null}
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
  );
}
