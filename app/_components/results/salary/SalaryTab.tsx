"use client";

import { CircleDollarSign } from "lucide-react";
import { formatCzk, labelize } from "@/app/_lib/format";
import type { Analysis } from "@/app/_lib/schemas";
import { InlineList } from "../shared";
import { SalaryGauge } from "./SalaryGauge";

export function SalaryTab({ analysis }: { analysis: Analysis }) {
  const targetSalary = Math.round((analysis.salary.midpoint * 1.3) / 5000) * 5000;

  return (
    <div className="grid gap-5 xl:grid-cols-[380px_1fr]">
      <div className="space-y-5">
        <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
          <div className="flex items-center gap-2">
            <CircleDollarSign className="h-5 w-5 text-coral" aria-hidden />
            <h3 className="text-base font-semibold">Salary Estimate</h3>
          </div>
          <div className="mt-5">
            <SalaryGauge
              minimum={analysis.salary.minimum}
              maximum={analysis.salary.maximum}
              midpoint={analysis.salary.midpoint}
              confidence={analysis.salary.confidence}
            />
          </div>
          <div className="mt-1 text-sm tabular-nums text-ink">
            {formatCzk(analysis.salary.minimum)}-{formatCzk(analysis.salary.maximum)}
          </div>
          <p className="mt-1 text-sm text-steel">CZK / month, {analysis.salary.confidence} confidence</p>
          <div className="mt-4 rounded-md bg-limewash p-3 text-sm font-medium text-ink">
            +30% growth target: {formatCzk(targetSalary)} CZK / month
          </div>
        </div>

        {analysis.companyContext ? (
          <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
            <h3 className="text-base font-semibold">Company Compensation Context</h3>
            <p className="mt-3 text-sm leading-6 text-ink">
              {labelize(analysis.companyContext.companyType)}: {analysis.companyContext.salaryEffect} ({analysis.companyContext.adjustmentFactor}x)
            </p>
            <ul className="mt-3 space-y-2">
              {analysis.companyContext.rationale.map((item) => (
                <li key={item} className="text-sm leading-6 text-ink">{item}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      <div className="space-y-5">
        <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
          <h3 className="text-base font-semibold">Salary Rationale</h3>
          <ul className="mt-4 space-y-3">
            {analysis.salary.rationale.map((item) => (
              <li key={item} className="text-sm leading-6 text-ink">{item}</li>
            ))}
          </ul>
        </div>

        {analysis.evidenceTrace ? (
          <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
            <InlineList
              title="Salary Evidence"
              items={analysis.evidenceTrace.salary}
              emptyHint="Mention current band, levelling, or comparable offers in your CV to ground the salary read."
            />
          </div>
        ) : null}

        {analysis.marketEvidence ? (
          <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
            <div className="flex items-center gap-2">
              <CircleDollarSign className="h-5 w-5 text-coral" aria-hidden />
              <h3 className="text-base font-semibold">Grounded Market Evidence</h3>
            </div>
            <p className="mt-3 text-sm leading-6 text-ink">{analysis.marketEvidence.summary}</p>
            <p className="mt-3 text-sm font-medium text-steel">
              Confidence: {analysis.marketEvidence.confidence}
              {analysis.marketEvidence.suggestedMinimum && analysis.marketEvidence.suggestedMaximum
                ? `, grounded range: ${formatCzk(analysis.marketEvidence.suggestedMinimum)}-${formatCzk(analysis.marketEvidence.suggestedMaximum)} CZK`
                : ""}
            </p>
            {analysis.marketEvidence.sources.length ? (
              <ul className="mt-3 space-y-2 text-sm leading-6">
                {analysis.marketEvidence.sources.slice(0, 3).map((source, index) => (
                  <li key={source}>
                    <a className="text-steel underline" href={source} target="_blank" rel="noreferrer">
                      Source {index + 1}
                    </a>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
