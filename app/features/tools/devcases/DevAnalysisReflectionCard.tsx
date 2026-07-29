"use client";

// The "Reality reflection" card (complexity/confidence + narrative + real stack
// + stated-vs-real gaps + risk areas), split out of DevAnalysisView.tsx.
import { ProvenanceStrip } from "./DevProvenanceStrip";
import { formatFraction } from "@/app/_lib/format";
import { COMPLEXITY } from "./DevTypes";
import type { NeedAnalysis, Result } from "./DevTypes";

export function DevAnalysisReflectionCard({ result, analysis }: { result: Result; analysis: NeedAnalysis }) {
  return (
    <div className="rounded-lg border border-stone-200 bg-white p-4 shadow-panel">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-meta uppercase tracking-wide text-steel">Reality reflection</span>
        {analysis.trueComplexity ? (
          <span className={`rounded-full px-2 py-0.5 text-micro font-semibold uppercase ${COMPLEXITY[analysis.trueComplexity] ?? "bg-stone-100 text-steel"}`}>
            {analysis.trueComplexity} complexity
          </span>
        ) : null}
        <span className="ml-auto flex items-center gap-1.5 text-micro uppercase text-steel">
          <ProvenanceStrip perStepSources={result.perStepSources} source={result.source} />
          <span>conf {formatFraction(analysis.confidence ?? 0, { label: "confidence" })}</span>
        </span>
      </div>
      <p className="text-base text-ink">{analysis.reflection}</p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {(analysis.realStack ?? []).map((s) => (
          <span key={s} className="rounded-full bg-paper px-2 py-0.5 text-micro text-ink">{s}</span>
        ))}
      </div>
      {(analysis.statedVsRealGaps ?? []).length > 0 ? (
        <div className="mt-3">
          <p className="text-micro font-semibold uppercase tracking-wide text-coral">Stated vs. real gaps</p>
          <ul className="mt-1 space-y-0.5">
            {(analysis.statedVsRealGaps ?? []).map((g, i) => (
              <li key={i} className="flex gap-1.5 text-sm text-ink"><span className="text-coral">•</span>{g}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {(analysis.riskAreas ?? []).length > 0 ? (
        <p className="mt-2 text-micro text-steel">Risk areas: {(analysis.riskAreas ?? []).join(" · ")}</p>
      ) : null}
    </div>
  );
}
