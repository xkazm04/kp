"use client";

import { CircleDollarSign } from "lucide-react";
import { useTranslations } from "next-intl";
import { labelize } from "@/app/_lib/format";
import { useNumberFormat } from "@/app/_lib/use-number-format";
import type { Analysis } from "@/app/_lib/schemas";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import { ConfidenceBadge } from "@/app/_components/Badge";
import { dedupeBy } from "@/app/_lib/dedupe";
import { safeHttpLinks } from "@/app/_lib/safe-url";
import { BulletList, InlineList } from "../shared";
import { SalaryGauge } from "./SalaryGauge";
import { growthMarkerPercent, roundGrowthTarget } from "./salaryGauge.logic";

export function SalaryTab({ analysis }: { analysis: Analysis }) {
  const t = useTranslations("report");
  const enumLabel = useEnumLabel();
  // Reader-locale digit grouping for every figure on this tab (format.ts
  // number-locale contract) — the currency code still comes from the analysis.
  const n = useNumberFormat();
  // UAT RECON-06 — this grade is the SALARY READ'S EVIDENCE STRENGTH, and it now
  // says so in its own words ("Strong evidence" / "Weak evidence", report.confidence.*).
  // It used to read "High confidence", which is the word this app also used for a
  // score's measurement interval, for a model's self-report and for an archetype's
  // signal agreement — four unrelated quantities under one label, on a scale that
  // is even INVERTED against the match band's (see Badge.tsx confidenceBandToken:
  // "tight" means high certainty, "high" means high certainty, "wide" means low).
  // The key names are left alone (they are the wire contract with the analysis
  // payload's `confidence` field); only the words a recruiter reads changed.
  const confidenceLabels = {
    high: t("confidence.high"),
    medium: t("confidence.medium"),
    low: t("confidence.low"),
    unknown: t("confidence.unknown"),
  };
  const { currency, period } = analysis.salary;
  // Currency-aware rounding (Direction 1 #c): step scales with the figure's
  // magnitude, so a EUR/USD salary no longer snaps to an absurd CZK-scaled 5000.
  const targetSalary = roundGrowthTarget(analysis.salary.midpoint);
  // The growth percent shown on the card is derived from the SAME rounded target
  // and the SAME pure helper the gauge marker uses (growthMarkerPercent), so the
  // card caption and the gauge marker can never disagree (Direction 1 #b). null
  // for a degenerate midpoint → the card drops the "+NN%" and reads a plain target.
  const growthPct = growthMarkerPercent(analysis.salary.midpoint, targetSalary);
  const periodLabel = enumLabel("period", period);
  // marketEvidence.sources are model-supplied (CV/JD text -> LLM), so they are
  // untrusted at this render boundary: vet to http(s) only, drop the rest, and
  // dedupe by normalized href before taking the first three.
  const marketLinks = analysis.marketEvidence
    ? dedupeBy(safeHttpLinks(analysis.marketEvidence.sources), (link) => link.href).slice(0, 3)
    : [];

  return (
    <div className="grid gap-5 xl:grid-cols-[380px_1fr]">
      <div className="space-y-5">
        <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
          <div className="flex items-center gap-2">
            <CircleDollarSign className="h-5 w-5 text-coral" aria-hidden />
            <h3 className="font-serif text-h3 text-ink">{t("panel.salaryEstimate")}</h3>
          </div>
          <div className="mt-5">
            <SalaryGauge
              minimum={analysis.salary.minimum}
              maximum={analysis.salary.maximum}
              midpoint={analysis.salary.midpoint}
              confidence={analysis.salary.confidence}
              target={targetSalary}
              currency={currency}
            />
          </div>
          <div className="mt-1 text-base nums text-ink">
            {n.salaryRange(analysis.salary.minimum, analysis.salary.maximum, { currency })}
          </div>
          <p className="mt-1 flex items-center gap-1.5 text-base text-steel">{enumLabel("period", period)} · <ConfidenceBadge value={analysis.salary.confidence} labels={confidenceLabels} /></p>
          {analysis.salary.structureNote ? (
            <p className="mt-2 text-sm leading-5 text-steel">+ {analysis.salary.structureNote}</p>
          ) : null}
          <div className="mt-4 rounded-md bg-limewash p-3 text-base font-medium text-ink">
            {growthPct != null
              ? t("panel.growthTarget", {
                  pct: growthPct,
                  amount: n.grouped(targetSalary),
                  currency,
                  period: periodLabel,
                })
              : t("panel.growthTargetPlain", {
                  amount: n.grouped(targetSalary),
                  currency,
                  period: periodLabel,
                })}
          </div>
        </div>

        {analysis.companyContext ? (
          <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
            <h3 className="font-serif text-h3 text-ink">{t("panel.companyCompContext")}</h3>
            <p className="mt-3 text-base leading-6 text-ink">
              {labelize(analysis.companyContext.companyType)}: {analysis.companyContext.salaryEffect} ({analysis.companyContext.adjustmentFactor}x)
            </p>
            <BulletList items={analysis.companyContext.rationale} listClassName="mt-3 space-y-2" />
          </div>
        ) : null}
      </div>

      <div className="space-y-5">
        <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
          <h3 className="font-serif text-h3 text-ink">{t("panel.salaryRationale")}</h3>
          <BulletList items={analysis.salary.rationale} listClassName="mt-4 space-y-3" />
        </div>

        {analysis.evidenceTrace ? (
          <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
            <InlineList
              title={t("panel.salaryEvidence")}
              items={analysis.evidenceTrace.salary}
              emptyHint={t("panel.salaryEvidenceHint")}
            />
          </div>
        ) : null}

        {analysis.marketEvidence ? (
          <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
            <div className="flex items-center gap-2">
              <CircleDollarSign className="h-5 w-5 text-coral" aria-hidden />
              <h3 className="font-serif text-h3 text-ink">{t("panel.groundedMarketEvidence")}</h3>
            </div>
            <p className="mt-3 text-base leading-6 text-ink">{analysis.marketEvidence.summary}</p>
            <p className="mt-3 flex flex-wrap items-center gap-1.5 text-base font-medium text-steel">
              {/* UAT RECON-06 — the market read's grade is the same evidence-strength
                  scale as the salary read's, so it takes the same localized words.
                  It was rendering WITHOUT `labels`, which dropped it through to the
                  hardcoded English fallback in Badge.tsx: a Czech report showed
                  "High confidence" beside "Silné podklady" for the same quantity. */}
              <ConfidenceBadge value={analysis.marketEvidence.confidence} labels={confidenceLabels} />
              {analysis.marketEvidence.suggestedMinimum && analysis.marketEvidence.suggestedMaximum
                ? t("panel.groundedRange", {
                    range: n.salaryRange(analysis.marketEvidence.suggestedMinimum, analysis.marketEvidence.suggestedMaximum, { currency }),
                  })
                : ""}
            </p>
            {marketLinks.length ? (
              <ul className="mt-3 space-y-2 text-base leading-6">
                {marketLinks.map((link) => (
                  <li key={link.href}>
                    <a className="text-steel underline" href={link.href} target="_blank" rel="noreferrer">
                      {link.hostname}
                    </a>
                  </li>
                ))}
              </ul>
            ) : null}
            {/* marketEvidence.notes — the caveats/methodology the grounding produced,
                dead payload until now. Guarded so no notes adds no chrome. */}
            {analysis.marketEvidence.notes.length > 0 ? (
              <div className="mt-3">
                <p className="text-meta uppercase tracking-wide text-steel">{t("panel.marketNotes")}</p>
                <BulletList
                  items={analysis.marketEvidence.notes}
                  listClassName="mt-2 space-y-1.5"
                  itemClassName="text-sm leading-5 text-steel"
                />
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
