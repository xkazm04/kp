"use client";

import { AlertTriangle, BadgeCheck, BrainCircuit } from "lucide-react";
import { useTranslations } from "next-intl";
import { FactorChart } from "@/app/_components/FactorChart";
import { ScoreDial } from "@/app/_components/ScoreDial";
import { labelize, reconcileScoreTotal } from "@/app/_lib/format";
import type { Analysis } from "@/app/_lib/schemas";
import { EnginePanel, InlineList, ListBlock, Metric } from "../shared";

export function ExtractionTab({ analysis }: { analysis: Analysis }) {
  const t = useTranslations("report");
  return (
    <div className="grid gap-5 xl:grid-cols-[380px_1fr]">
      <div className="space-y-5">
        <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-base font-medium text-steel">{analysis.candidate.name ?? t("panel.candidate")}</p>
              <h2 className="mt-1 text-2xl font-semibold text-ink">{labelize(analysis.candidate.currentSeniority)}</h2>
              <p className="mt-1 text-base text-steel">{labelize(analysis.candidate.roleFamily)}</p>
            </div>
            {/* Dial reads the component sum, not the raw pipeline total, so the
                arc can never disagree with the FactorChart bars below it (the
                score-breakdown invariant; see reconcileScoreTotal). */}
            <ScoreDial score={reconcileScoreTotal(analysis.score)} />
          </div>
        </div>

        {analysis.extractionQuality ? (
          <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
            <h3 className="font-serif text-h3 text-ink">{t("panel.extractionQuality")}</h3>
            <div className="mt-3 grid gap-3 text-base sm:grid-cols-2">
              <Metric label="pypdf skills" value={analysis.extractionQuality.pypdfSkills} />
              <Metric label="Gemini skills" value={analysis.extractionQuality.geminiSkills} />
              <Metric label="pypdf spacing artifacts" value={analysis.extractionQuality.pypdfLetterSpacingHits} />
              <Metric label="Gemini spacing artifacts" value={analysis.extractionQuality.geminiLetterSpacingHits} />
            </div>
            <p className="mt-3 text-base leading-6 text-ink">{analysis.extractionQuality.recommendation}</p>
          </div>
        ) : null}

        <EnginePanel analysis={analysis} />
      </div>

      <div className="space-y-5">
        {analysis.extractionComparison ? (
          <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
            <h3 className="font-serif text-h3 text-ink">{t("panel.extractorComparison")}</h3>
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <TextPreview title="pypdf extraction" text={analysis.extractionComparison.pypdfText} />
              <TextPreview title="Gemini extraction" text={analysis.extractionComparison.geminiText} />
            </div>
          </div>
        ) : null}

        <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
          <div className="flex items-center gap-2">
            <BrainCircuit className="h-5 w-5 text-coral" aria-hidden />
            <h3 className="font-serif text-h3 text-ink">{t("panel.scoreBreakdown")}</h3>
          </div>
          <FactorChart score={analysis.score} />
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          <ListBlock
            icon={<BadgeCheck className="h-5 w-5 text-moss" />}
            title={t("panel.strengths")}
            items={analysis.strengths}
            emptyHeadline={t("panel.strengthsEmpty")}
            emptyHint={t("panel.strengthsHint")}
          />
          <ListBlock
            icon={<AlertTriangle className="h-5 w-5 text-coral" />}
            title={t("panel.gaps")}
            items={analysis.gaps}
            emptyHeadline={t("panel.gapsEmpty")}
            emptyHint={t("panel.gapsHint")}
          />
        </div>

        {analysis.evidenceTrace ? (
          <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
            <h3 className="font-serif text-h3 text-ink">{t("panel.evidenceTrace")}</h3>
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <InlineList
                title={t("panel.experienceEvidence")}
                items={analysis.evidenceTrace.experience}
                emptyHint={t("panel.experienceEvidenceHint")}
              />
              <InlineList
                title={t("panel.skillEvidence")}
                items={analysis.evidenceTrace.skills}
                emptyHint={t("panel.skillEvidenceHint")}
              />
              <InlineList
                title={t("panel.seniorityEvidence")}
                items={analysis.evidenceTrace.seniority}
                emptyHint={t("panel.seniorityEvidenceHint")}
              />
              <InlineList
                title={t("panel.educationEvidence")}
                items={analysis.evidenceTrace.education}
                emptyHint={t("panel.educationEvidenceHint")}
              />
            </div>
          </div>
        ) : null}

        <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
          <h3 className="font-serif text-h3 text-ink">{t("panel.llmExplanation")}</h3>
          <p className="mt-3 text-base leading-6 text-ink">{analysis.explanation}</p>
        </div>
      </div>
    </div>
  );
}

function TextPreview({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-md bg-paper p-3">
      <h4 className="text-base font-semibold text-ink">{title}</h4>
      <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap text-sm leading-5 text-ink">{text}</pre>
    </div>
  );
}
