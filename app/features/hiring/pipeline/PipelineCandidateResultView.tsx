"use client";

import { useTranslations } from "next-intl";
import { RATING_MAX } from "@/app/_lib/format";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import type { ScorecardRating } from "@/app/_lib/interview-scorecard";
import { APPLIED_LABEL, type Result } from "./PipelineCandidateDrawerTypes";
import { SalaryBenchmarkHint } from "./PipelineSalaryBenchmarkHint";

function SourceBadge({ source }: { source: string }) {
  const t = useTranslations("pipeline.result");
  const llm = source === "llm";
  return (
    <span className={`rounded-full px-2 py-0.5 text-sm font-semibold uppercase ${llm ? "bg-coral/15 text-coral" : "bg-stone-200 text-steel"}`}>
      {llm ? t("claudeCli") : t("template")}
    </span>
  );
}

export function ResultView({ result, roleFamily }: { result: Result; roleFamily?: string | null }) {
  const t = useTranslations("pipeline.result");
  const tApplied = useTranslations("pipeline.applied");
  const enumLabel = useEnumLabel();
  const d = result.data as Record<string, unknown>;
  // Localized applied-outcome label, falling back to the English source for any
  // key not yet in the catalog.
  const appliedKey = result.applied as Parameters<typeof tApplied>[0];
  const applied = result.applied
    ? tApplied.has(appliedKey)
      ? tApplied(appliedKey)
      : APPLIED_LABEL[result.applied]
    : undefined;
  return (
    <div className="animate-fade-in rounded-lg border border-stone-200 bg-white p-3 shadow-panel">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm font-semibold uppercase tracking-wide text-steel">
          {t(`task.${result.task}` as Parameters<typeof t>[0])}
        </p>
        <SourceBadge source={result.source} />
      </div>

      {(result.task === "outreach" || result.task === "rejection") && (
        <div className="space-y-1.5">
          <p className="text-base font-semibold text-ink">{String(d.subject ?? "")}</p>
          <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-ink">{String(d.body ?? "")}</pre>
          {d.feedback ? <p className="text-sm text-steel">{t("feedback", { text: String(d.feedback) })}</p> : null}
          <p className="text-sm uppercase text-steel">{String(d.language ?? "")}</p>
        </div>
      )}

      {result.task === "screen" && (
        <div className="space-y-1.5 text-sm text-ink">
          <p>
            <span className="font-semibold uppercase">{enumLabel("recommendation", String(d.recommendation ?? ""))}</span>
            {typeof d.confidence === "number" ? t("confidence", { confidence: d.confidence }) : ""}
          </p>
          <p>{String(d.rationale ?? "")}</p>
        </div>
      )}

      {result.task === "prep" && (
        <ol className="list-decimal space-y-2 pl-4 text-sm text-ink">
          {((d.questions as { competency?: string; question?: string; whatsGoodLooksLike?: string }[]) ?? []).map((q, i) => (
            <li key={i}>
              <span className="font-semibold">{q.question}</span>
              {q.whatsGoodLooksLike ? <span className="block text-sm text-steel">{t("goodAnswer", { text: q.whatsGoodLooksLike })}</span> : null}
            </li>
          ))}
        </ol>
      )}

      {result.task === "scorecard" && (
        <div className="space-y-1.5 text-sm text-ink">
          <p className="font-semibold uppercase">{enumLabel("recommendation", String(d.recommendation ?? ""))}</p>
          {d.summary ? <p>{String(d.summary)}</p> : null}
          <ul className="space-y-0.5">
            {((d.ratings as ScorecardRating[]) ?? []).map((r, i) => (
              <li key={i} className="flex justify-between">
                <span className="text-steel">{r.competency}</span>
                <span className="font-semibold">{r.rating}/{RATING_MAX}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {result.task === "offer" && (
        <div className="space-y-2 text-sm text-ink">
          <div className="flex items-baseline gap-2">
            <span className="font-serif text-2xl text-ink">{Number(d.recommended ?? 0).toLocaleString()}</span>
            <span className="text-steel">{String(d.currency ?? "CZK")} {t("perMonth")}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-stone-200">
            <div
              className="h-full rounded-full bg-moss"
              style={{
                width: `${Math.max(4, Math.min(100, ((Number(d.recommended) - Number(d.salaryMin)) / Math.max(1, Number(d.salaryMax) - Number(d.salaryMin))) * 100))}%`,
              }}
            />
          </div>
          <p className="text-sm text-steel">
            {t("band", {
              min: Number(d.salaryMin ?? 0).toLocaleString(),
              max: Number(d.salaryMax ?? 0).toLocaleString(),
              currency: String(d.currency ?? ""),
            })}
          </p>
          {/* Phase 2 — the cross-company market band for this role, alongside the
              candidate's own analyzed band, so the recruiter sets comp against the market. */}
          {roleFamily ? <SalaryBenchmarkHint roleFamily={roleFamily} /> : null}
          <p className="text-steel">{String(d.rationale ?? "")}</p>
          <p className="mt-1 font-semibold text-ink">{String(d.subject ?? "")}</p>
          <pre className="whitespace-pre-wrap font-sans leading-relaxed text-ink">{String(d.body ?? "")}</pre>
        </div>
      )}

      {result.task === "rematch" && (
        <div className="space-y-1 text-sm text-ink">
          {d.found ? (
            <>
              <p className="font-semibold">
                {String(d.jobTitle ?? "")} <span className="text-moss">{t("matchSuffix", { score: String(d.score ?? "") })}</span>
              </p>
              <p className="text-steel">{String(d.rationale ?? "")}</p>
            </>
          ) : (
            <p className="text-steel">{d.reason ? String(d.reason) : t("noAlternative")}</p>
          )}
        </div>
      )}

      {applied ? <p className="mt-2 rounded bg-moss/10 px-2 py-1 text-sm font-semibold text-moss">{applied}</p> : null}
    </div>
  );
}
