"use client";

import { CircleDollarSign } from "lucide-react";
import { useTranslations } from "next-intl";
import { RATING_MAX } from "@/app/_lib/format";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import { useNumberFormat } from "@/app/_lib/use-number-format";
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
  // salary-hint-knows-the-level — every figure in this card reads in the READER's
  // locale. `Number(x).toLocaleString()` is the RUNTIME's locale (the browser's, or
  // the server's on an SSR pass), so a Czech reader of an English-default install
  // got "65,000" beside the market band's "65 000" one line below — two number
  // grammars in one paragraph. format.ts's number-locale contract is what the
  // benchmark hint already keeps; the candidate's own band now keeps it too.
  const { grouped } = useNumberFormat();
  const d = result.data as Record<string, unknown>;
  // WHY NO ALTERNATIVE — in the reader's language. A skipped rematch used to paint the
  // server's English sentence ("candidate is hired; rematch skipped") verbatim on a
  // Czech recruiter's screen. automation-run.ts now emits `reasonCode` beside that
  // sentence (the record-vs-screen split automation-pass.ts already runs); the English
  // stays canonical for a legacy row and for anything this build has no word for.
  const rematchReason = (): string => {
    const code = typeof d.reasonCode === "string" ? d.reasonCode : "";
    const key = `reasons.${code}` as Parameters<typeof t>[0];
    if (code && t.has(key)) return t(key);
    return d.reason ? String(d.reason) : t("noAlternative");
  };
  // Localized applied-outcome label, falling back to the English source for any
  // key not yet in the catalog.
  const appliedKey = result.applied as Parameters<typeof tApplied>[0];
  const applied = result.applied
    ? tApplied.has(appliedKey)
      ? tApplied(appliedKey)
      : APPLIED_LABEL[result.applied]
    : undefined;

  // UNPRICED DRAFTS (draft_offer's FAIL SAFE, pipeline/jobfit/automation.py) — the exact
  // twin of the AiReviewCard case fixed in c693303. When the active market configures no
  // seniority band AND the posting carries none, the drafter deliberately proposes NO
  // figure: recommended / salaryMin / salaryMax come back null TOGETHER, the candidate
  // letter names no number, and the draft routes to the human offer_review gate precisely
  // so a recruiter sets the real one. This view used to pull those nulls through
  // `Number(x ?? 0).toLocaleString()` — a literal "0" headline, a 0–0 band meter with the
  // marker pinned at the floor, and a `?? "CZK"` default that additionally mislabelled the
  // currency for a non-CZK market. So: no figure, no meter and no unit unless the payload
  // genuinely carries them.
  const unpriced = result.task === "offer" && d.recommended == null;
  const hasBand = result.task === "offer" && d.salaryMin != null && d.salaryMax != null;

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
          {unpriced ? (
            // The exact twin of the AiReviewCard treatment (c693303), same chip grammar:
            // no figure was proposed, so name that instead of formatting a zero. No
            // currency and no "/ mo" either — both would describe an amount that
            // doesn't exist.
            <span
              className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-meta font-semibold text-amber-800"
              title={t("unpricedTitle")}
            >
              <CircleDollarSign size={11} aria-hidden /> {t("unpricedAmount")}
            </span>
          ) : (
            <div className="flex items-baseline gap-2">
              <span className="font-serif text-2xl text-ink">{grouped(Number(d.recommended))}</span>
              {/* The server deliberately refuses to fabricate a currency (draft_offer
                  labels the offer in the ACTIVE market's currency), so this must not
                  default to "CZK" — that mislabels every non-CZK market. Absent
                  currency renders the bare amount and its period. The JSX shape is
                  otherwise untouched, so a priced draft (which always carries a
                  currency) emits character-for-character the markup it did before. */}
              <span className="text-steel">{String(d.currency ?? "")} {t("perMonth")}</span>
            </div>
          )}
          {/* The meter and the band caption are a POSITION-WITHIN-A-BAND readout; with no
              band they'd be a 0–0 rail with the marker pinned at the floor. Rendered only
              when the draft actually carries min AND max. */}
          {hasBand ? (
            <>
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
                  min: grouped(Number(d.salaryMin)),
                  max: grouped(Number(d.salaryMax)),
                  currency: String(d.currency ?? ""),
                })}
              </p>
            </>
          ) : (
            <p className="rounded-md border border-dashed border-stone-300 px-2 py-1.5 text-sm text-steel">{t("noBand")}</p>
          )}
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
            <p className="text-steel">{rematchReason()}</p>
          )}
        </div>
      )}

      {applied ? <p className="mt-2 rounded bg-moss/10 px-2 py-1 text-sm font-semibold text-moss">{applied}</p> : null}
    </div>
  );
}
