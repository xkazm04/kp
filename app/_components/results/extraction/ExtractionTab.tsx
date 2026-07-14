"use client";

import { AlertTriangle, BadgeCheck, BrainCircuit } from "lucide-react";
import { useTranslations } from "next-intl";
import { FactorChart } from "@/app/_components/FactorChart";
import { ScoreDial } from "@/app/_components/ScoreDial";
import { labelize, reconcileScoreTotal } from "@/app/_lib/format";
import type { Analysis } from "@/app/_lib/schemas";
import { dedupeBy } from "@/app/_lib/dedupe";
import { safeHttpLinks } from "@/app/_lib/safe-url";
import { EnginePanel, InlineList, LazyDetails, ListBlock, Metric } from "../shared";

export function ExtractionTab({ analysis }: { analysis: Analysis }) {
  const t = useTranslations("report");
  const candidate = analysis.candidate;
  // These fields are nullish in the schema (absent on pre-P0-4 analyses), so default
  // each to [] before use. Candidate-supplied links are untrusted at this render
  // boundary — vet to http(s) only and dedupe (same gate SalaryTab's links use).
  const credentials = candidate.credentials ?? [];
  const publications = candidate.publications ?? [];
  const candidateLinks = dedupeBy(safeHttpLinks(candidate.links ?? []), (link) => link.href);
  const hasCredEvidence = credentials.length > 0 || publications.length > 0 || candidateLinks.length > 0;
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

        {hasCredEvidence ? (
          <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
            <div className="flex items-center gap-2">
              <BadgeCheck className="h-5 w-5 text-moss" aria-hidden />
              <h3 className="font-serif text-h3 text-ink">{t("panel.credentialsWork")}</h3>
            </div>
            {credentials.length > 0 ? (
              <div className="mt-4">
                <p className="text-meta uppercase tracking-wide text-steel">{t("panel.credentials")}</p>
                <ul className="mt-2 space-y-1.5 text-base leading-6 text-ink">
                  {credentials.map((c, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <BadgeCheck className="mt-0.5 h-4 w-4 shrink-0 text-moss" aria-hidden />
                      <span>
                        <span className="font-medium">{c.name}</span>
                        {c.issuer ? ` · ${c.issuer}` : ""}
                        {c.identifier ? ` · ${c.identifier}` : ""}
                        {c.expiry ? ` · ${c.expiry}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {publications.length > 0 ? (
              <div className="mt-4">
                <p className="text-meta uppercase tracking-wide text-steel">{t("panel.publications")}</p>
                <ul className="mt-2 space-y-1.5 text-base leading-6 text-ink">
                  {publications.map((p, i) => (
                    <li key={i}>
                      <span className="font-medium">{p.title}</span>
                      {p.venue ? ` · ${p.venue}` : ""}
                      {p.year ? ` · ${p.year}` : ""}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {candidateLinks.length > 0 ? (
              <div className="mt-4">
                <p className="text-meta uppercase tracking-wide text-steel">{t("panel.links")}</p>
                <ul className="mt-2 space-y-1.5 text-base leading-6">
                  {candidateLinks.map((link) => (
                    <li key={link.href}>
                      <a className="text-steel underline" href={link.href} target="_blank" rel="noreferrer">
                        {link.hostname}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}

        {analysis.extractionQuality ? (
          <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
            <h3 className="font-serif text-h3 text-ink">{t("panel.extractionQuality")}</h3>
            <p className="mt-1 text-sm leading-5 text-steel">{t("panel.extractionQualityCaption")}</p>
            <p className="mt-3 text-base leading-6 text-ink">{analysis.extractionQuality.recommendation}</p>
            {/* Raw per-parser counts are engine diagnostics, not a recruiter signal —
                relabeled to outcome language and tucked behind a disclosure. */}
            <details className="mt-3">
              <summary className="focus-ring cursor-pointer text-sm font-medium text-steel">{t("panel.parserDetails")}</summary>
              <div className="mt-3 grid gap-3 text-base sm:grid-cols-2">
                <Metric label={t("panel.pqSkillsFast")} value={analysis.extractionQuality.pypdfSkills} />
                <Metric label={t("panel.pqSkillsAi")} value={analysis.extractionQuality.geminiSkills} />
                <Metric label={t("panel.pqArtifactsFast")} value={analysis.extractionQuality.pypdfLetterSpacingHits} />
                <Metric label={t("panel.pqArtifactsAi")} value={analysis.extractionQuality.geminiLetterSpacingHits} />
              </div>
            </details>
          </div>
        ) : null}

        <EnginePanel analysis={analysis} />
      </div>

      <div className="space-y-5">
        {analysis.extractionComparison ? (
          <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
            <h3 className="font-serif text-h3 text-ink">{t("panel.extractorComparison")}</h3>
            {/* The two raw extracted-text dumps are a diagnostic — collapsed by default,
                and (via LazyDetails) not mounted into the DOM until the first expand so
                two large <pre> blocks don't ride every report render unopened. */}
            <LazyDetails
              className="mt-3"
              summaryClassName="focus-ring cursor-pointer text-sm font-medium text-steel"
              summary={t("panel.showExtractedText")}
            >
              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                <TextPreview title={t("panel.parserFast")} text={analysis.extractionComparison.pypdfText} />
                <TextPreview title={t("panel.parserAi")} text={analysis.extractionComparison.geminiText} />
              </div>
            </LazyDetails>
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
