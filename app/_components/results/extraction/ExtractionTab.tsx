"use client";

import { AlertTriangle, BadgeCheck, BrainCircuit } from "lucide-react";
import { FactorChart } from "@/app/_components/FactorChart";
import { ScoreDial } from "@/app/_components/ScoreDial";
import { labelize } from "@/app/_lib/format";
import type { Analysis } from "@/app/_lib/schemas";
import { EnginePanel, InlineList, ListBlock, Metric } from "../shared";

export function ExtractionTab({ analysis }: { analysis: Analysis }) {
  return (
    <div className="grid gap-5 xl:grid-cols-[380px_1fr]">
      <div className="space-y-5">
        <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-steel">{analysis.candidate.name ?? "Candidate"}</p>
              <h2 className="mt-1 text-2xl font-semibold text-ink">{labelize(analysis.candidate.currentSeniority)}</h2>
              <p className="mt-1 text-sm text-steel">{labelize(analysis.candidate.roleFamily)}</p>
            </div>
            <ScoreDial score={analysis.score.total} />
          </div>
        </div>

        {analysis.extractionQuality ? (
          <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
            <h3 className="font-serif text-h3 text-ink">Extraction Quality</h3>
            <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
              <Metric label="pypdf skills" value={analysis.extractionQuality.pypdfSkills} />
              <Metric label="Gemini skills" value={analysis.extractionQuality.geminiSkills} />
              <Metric label="pypdf spacing artifacts" value={analysis.extractionQuality.pypdfLetterSpacingHits} />
              <Metric label="Gemini spacing artifacts" value={analysis.extractionQuality.geminiLetterSpacingHits} />
            </div>
            <p className="mt-3 text-sm leading-6 text-ink">{analysis.extractionQuality.recommendation}</p>
          </div>
        ) : null}

        <EnginePanel analysis={analysis} />
      </div>

      <div className="space-y-5">
        {analysis.extractionComparison ? (
          <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
            <h3 className="font-serif text-h3 text-ink">Extractor Comparison</h3>
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <TextPreview title="pypdf extraction" text={analysis.extractionComparison.pypdfText} />
              <TextPreview title="Gemini extraction" text={analysis.extractionComparison.geminiText} />
            </div>
          </div>
        ) : null}

        <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
          <div className="flex items-center gap-2">
            <BrainCircuit className="h-5 w-5 text-coral" aria-hidden />
            <h3 className="font-serif text-h3 text-ink">Score Breakdown</h3>
          </div>
          <FactorChart score={analysis.score} />
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          <ListBlock
            icon={<BadgeCheck className="h-5 w-5 text-moss" />}
            title="Strengths"
            items={analysis.strengths}
            emptyHeadline="No strengths surfaced"
            emptyHint="Add quantified outcomes and signature projects so we can flag what stands out."
          />
          <ListBlock
            icon={<AlertTriangle className="h-5 w-5 text-coral" />}
            title="Gaps"
            items={analysis.gaps}
            emptyHeadline="No gaps detected"
            emptyHint="Nothing obviously missing - attach a job description for role-specific gap analysis."
          />
        </div>

        {analysis.evidenceTrace ? (
          <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
            <h3 className="font-serif text-h3 text-ink">Evidence Trace</h3>
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <InlineList
                title="Experience Evidence"
                items={analysis.evidenceTrace.experience}
                emptyHint="Add roles with dates and outcomes so we can cite your experience."
              />
              <InlineList
                title="Skill Evidence"
                items={analysis.evidenceTrace.skills}
                emptyHint="List concrete tools and methods you have shipped with to surface skill evidence."
              />
              <InlineList
                title="Seniority Evidence"
                items={analysis.evidenceTrace.seniority}
                emptyHint="Mention scope, team size, or ownership signals to anchor your seniority."
              />
              <InlineList
                title="Education Evidence"
                items={analysis.evidenceTrace.education}
                emptyHint="Add degrees, programs, or certifications to populate education evidence."
              />
            </div>
          </div>
        ) : null}

        <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
          <h3 className="font-serif text-h3 text-ink">LLM Explanation</h3>
          <p className="mt-3 text-sm leading-6 text-ink">{analysis.explanation}</p>
        </div>
      </div>
    </div>
  );
}

function TextPreview({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-md bg-paper p-3">
      <h4 className="text-sm font-semibold text-ink">{title}</h4>
      <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap text-xs leading-5 text-ink">{text}</pre>
    </div>
  );
}
