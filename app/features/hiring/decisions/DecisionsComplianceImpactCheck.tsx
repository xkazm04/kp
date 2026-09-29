"use client";

// The four-fifths adverse-impact check — pure, in-browser, nothing stored.
// Split out of DecisionsComplianceSection so that component stays under 200
// lines. Parses pasted group counts and renders the ratio table + verdict.
import { useMemo, useState } from "react";
import { AlertTriangle, Check, HelpCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { computeAdverseImpact, parseGroupCounts, ADVERSE_IMPACT_MIN_COHORT } from "@/app/_lib/adverse-impact";
import { TextArea } from "@/app/_components/TextArea";

type Verdict = "insufficient" | "adverse" | "belowNotSignificant" | "significantGap" | "clean";
const VERDICT_TONE: Record<Verdict, string> = {
  insufficient: "text-steel",
  adverse: "text-coral",
  belowNotSignificant: "text-steel",
  significantGap: "text-coral",
  clean: "text-moss",
};
const VERDICT_KEY = {
  adverse: "anyAdverse",
  belowNotSignificant: "belowNotSignificant",
  significantGap: "significantGap",
  clean: "noAdverse",
} as const;

function formatP(p: number): string {
  return p < 0.001 ? "< 0.001" : p.toFixed(3);
}

export function DecisionsComplianceImpactCheck() {
  const t = useTranslations("decisions.compliance");
  const [counts, setCounts] = useState("");
  const parsed = useMemo(() => parseGroupCounts(counts), [counts]);
  const impact = useMemo(() => (parsed.groups.length >= 2 ? computeAdverseImpact(parsed.groups) : null), [parsed]);
  const verdict: Verdict = !impact || !impact.reliable
    ? "insufficient"
    : impact.anySignificantAdverse
      ? "adverse"
      : impact.anyAdverseImpact
        ? "belowNotSignificant"
        : impact.anySignificantGapAboveThreshold
          ? "significantGap"
          : "clean";

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
                <th scope="col" className="py-1 pr-2 font-medium">{t("colGroup")}</th>
                <th scope="col" className="py-1 pr-2 font-medium">{t("colRate")}</th>
                <th scope="col" className="py-1 pr-2 font-medium">{t("colRatio")}</th>
                <th scope="col" className="py-1 pr-2 font-medium">{t("colShortfall")}</th>
                <th scope="col" className="py-1 pr-2 font-medium">{t("colP")}</th>
                <th scope="col" className="py-1 font-medium">{t("colStatus")}</th>
              </tr>
            </thead>
            <tbody>
              {/* Keyed by position: the parser keeps duplicate group names as separate rows. */}
              {impact.groups.map((g, i) => (
                <tr key={`${i}:${g.group}`} className="border-t border-stone-100">
                  <td className="py-1 pr-2 text-ink">{g.group}</td>
                  <td className="nums py-1 pr-2 text-steel">
                    {(g.selectionRate * 100).toFixed(0)}% <span className="text-stone-400">({g.selected}/{g.total})</span>
                  </td>
                  <td className="nums py-1 pr-2 text-steel">{g.impactRatio === null ? "—" : g.impactRatio.toFixed(2)}</td>
                  {/* Shortfall is a count of people and grows with N, so it is shown with
                      its share of the group; the p-value beside it says whether chance
                      could explain the gap at these sizes. Neither is read alone. */}
                  <td className="nums py-1 pr-2 text-steel">
                    {g.shortfall === null || g.shortfall === 0
                      ? "—"
                      : t("shortfallValue", { people: g.shortfall.toFixed(1), share: ((100 * g.shortfall) / g.total).toFixed(1) })}
                  </td>
                  <td className="nums py-1 pr-2 text-steel">{g.pValue === null ? "—" : formatP(g.pValue)}</td>
                  <td className="py-1">
                    {g.isReference ? (
                      <span className="text-steel">{t("statusReference")}</span>
                    ) : g.impactRatio === null ? (
                      <span className="text-stone-400">{t("statusNa")}</span>
                    ) : g.adverseImpact && g.significant ? (
                      <span className="font-semibold text-coral">{t("statusAdverse")}</span>
                    ) : g.adverseImpact ? (
                      <span className="text-steel">{t("statusBelowNotSignificant")}</span>
                    ) : g.significant && (g.shortfall ?? 0) > 0 ? (
                      <span className="font-semibold text-coral">{t("statusSignificantGap")}</span>
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
              so a binary green/red readout would render a legally-loaded false clean.
              And the ratio is read with its significance test, in both directions: a
              flag chance can explain is a pattern to watch, and a significant gap above
              0.8 is not a pass. */}
          <p className={`mt-2 flex items-center gap-1.5 text-sm font-medium ${VERDICT_TONE[verdict]}`}>
            {verdict === "insufficient" ? (
              <HelpCircle size={14} />
            ) : verdict === "clean" ? (
              <Check size={14} />
            ) : (
              <AlertTriangle size={14} />
            )}
            {verdict === "insufficient"
              ? t("insufficientSample", { min: ADVERSE_IMPACT_MIN_COHORT })
              : t(VERDICT_KEY[verdict])}
          </p>
          {/* A verdict that found nothing owes what it could have found: a non-significant
              line is silent about every gap smaller than the detectable ratio, and at
              these cohort sizes that is most of them. Only the not-significant verdicts
              carry it; a significant gap needs no such statement. */}
          {impact.detectableRatio !== null && (verdict === "clean" || verdict === "belowNotSignificant") ? (
            <p className="mt-1 text-meta text-steel">
              {Math.floor(impact.detectableRatio * 100) < 1
                ? t("detectableBlind")
                : t("detectable", { pct: Math.floor(impact.detectableRatio * 100) })}
            </p>
          ) : null}
          {impact.reliable && impact.unassessedGroups > 0 ? (
            <p className="mt-1 text-meta text-steel">
              {t("notAssessed", { count: impact.unassessedGroups, min: ADVERSE_IMPACT_MIN_COHORT })}
            </p>
          ) : null}
        </div>
      ) : (
        <p className="mt-2 text-meta text-steel">{t("aiCheckHint")}</p>
      )}
    </details>
  );
}
