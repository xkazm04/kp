"use client";

import { CircleDollarSign } from "lucide-react";
import { formatCzk, formatSalaryRange, labelize } from "@/app/_lib/format";
import type { Analysis } from "@/app/_lib/schemas";
import { ConfidenceBadge } from "@/app/_components/Badge";
import { dedupeBy } from "@/app/_lib/dedupe";
import { safeHttpLinks } from "@/app/_lib/safe-url";
import { BulletList, InlineList } from "../shared";
import { SalaryGauge } from "./SalaryGauge";

export function SalaryTab({ analysis }: { analysis: Analysis }) {
  const targetSalary = Math.round((analysis.salary.midpoint * 1.3) / 5000) * 5000;
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
            <h3 className="font-serif text-h3 text-ink">Salary Estimate</h3>
          </div>
          <div className="mt-5">
            <SalaryGauge
              minimum={analysis.salary.minimum}
              maximum={analysis.salary.maximum}
              midpoint={analysis.salary.midpoint}
              confidence={analysis.salary.confidence}
              target={targetSalary}
            />
          </div>
          <div className="mt-1 text-base nums text-ink">
            {formatSalaryRange(analysis.salary.minimum, analysis.salary.maximum)}
          </div>
          <p className="mt-1 flex items-center gap-1.5 text-base text-steel">per month · <ConfidenceBadge value={analysis.salary.confidence} /></p>
          <div className="mt-4 rounded-md bg-limewash p-3 text-base font-medium text-ink">
            +30% growth target: {formatCzk(targetSalary)} CZK / month
          </div>
        </div>

        {analysis.companyContext ? (
          <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
            <h3 className="font-serif text-h3 text-ink">Company Compensation Context</h3>
            <p className="mt-3 text-base leading-6 text-ink">
              {labelize(analysis.companyContext.companyType)}: {analysis.companyContext.salaryEffect} ({analysis.companyContext.adjustmentFactor}x)
            </p>
            <BulletList items={analysis.companyContext.rationale} listClassName="mt-3 space-y-2" />
          </div>
        ) : null}
      </div>

      <div className="space-y-5">
        <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
          <h3 className="font-serif text-h3 text-ink">Salary Rationale</h3>
          <BulletList items={analysis.salary.rationale} listClassName="mt-4 space-y-3" />
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
              <h3 className="font-serif text-h3 text-ink">Grounded Market Evidence</h3>
            </div>
            <p className="mt-3 text-base leading-6 text-ink">{analysis.marketEvidence.summary}</p>
            <p className="mt-3 flex flex-wrap items-center gap-1.5 text-base font-medium text-steel">
              <ConfidenceBadge value={analysis.marketEvidence.confidence} />
              {analysis.marketEvidence.suggestedMinimum && analysis.marketEvidence.suggestedMaximum
                ? `grounded range: ${formatSalaryRange(analysis.marketEvidence.suggestedMinimum, analysis.marketEvidence.suggestedMaximum)}`
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
          </div>
        ) : null}
      </div>
    </div>
  );
}
