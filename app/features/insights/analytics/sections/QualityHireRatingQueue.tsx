"use client";

// challenge-r07 pipeline-api/B — rate hires where the count is.
//
// The Quality verdict states "rated X of Y hires, N more needed", and until this
// list it then sent the reader to the hiring board to open hired candidates one by
// one and find which were unrated. The GET behind that line now returns the unrated
// hires (oldest hire first, capped, label / role / hire date only), and this lists
// them with the same 1..5 control the candidate drawer uses
// (PipelineHireOutcomeCard). A pick POSTs the ONE write door the drawer uses (it
// asks pipeline:write and re-checks the live terminal stage), then re-reads the
// counter, so the row leaves and the line moves only on what the server accepted.
//
// Rows name people awaiting a judgement, never a judgement: nothing here shows a
// score or a prior rating. A refusal (a viewer seat, a hire moved off the terminal
// column since the read) renders through useErrorMessage in the reader's language.
import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { useDateFormat } from "@/app/_components/ui/useDateFormat";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import { EYEBROW, TOGGLE_GROUP, toggleBtn } from "@/app/_components/ui/recipes";
import { HIRE_RATING_LEVELS, type UnratedHire } from "@/app/_lib/hire-rating-queue";

export function QualityHireRatingQueue({
  unrated,
  unratedTotal,
  open,
  onRated,
}: {
  unrated: UnratedHire[];
  unratedTotal: number;
  /** Open while the curve still needs ratings; collapsed (still offered) once it has enough. */
  open: boolean;
  /** Re-read the counter after a rating the server accepted. */
  onRated: () => void;
}) {
  const t = useTranslations("analytics.quality");
  // The drawer's own labels for the same control, one source for both surfaces.
  const td = useTranslations("pipeline.drawer.hireOutcome");
  const errorMessage = useErrorMessage();
  const [saving, setSaving] = useState<string | null>(null);
  const [failed, setFailed] = useState<{ entryId: string; message: string } | null>(null);
  const { date: formatDate } = useDateFormat();
  const max = HIRE_RATING_LEVELS[HIRE_RATING_LEVELS.length - 1];

  const rate = useCallback(
    async (entryId: string, performance: number) => {
      setSaving(entryId);
      setFailed(null);
      try {
        const res = await fetch("/api/pipeline/outcomes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ entryId, performance }),
        });
        const payload = (await res.json().catch(() => ({}))) as { ok?: boolean; code?: string | null };
        if (!res.ok || !payload.ok) {
          setFailed({ entryId, message: errorMessage(payload, td("saveFailed")) });
          return;
        }
        onRated();
      } catch {
        setFailed({ entryId, message: td("saveFailed") });
      } finally {
        setSaving(null);
      }
    },
    [errorMessage, onRated, td]
  );

  if (unratedTotal <= 0) return null;

  // An unparseable or missing stamp states no date rather than a placeholder dash.
  const hiredOn = (row: UnratedHire): string | null => (row.hiredAt ? formatDate(row.hiredAt, { fallback: "" }) || null : null);

  return (
    <details open={open} className="group mt-3 max-w-3xl rounded-md border border-stone-200 bg-stone-50 p-3">
      <summary className="focus-ring cursor-pointer rounded text-body font-medium text-ink">
        {t("hireQueueSummary", { count: unratedTotal })}
      </summary>
      <p className={`${EYEBROW} mt-3`}>{t("hireQueueTitle")}</p>
      <p className="mt-1 text-meta leading-relaxed text-steel">
        {t("hireQueueIntro")} {td("scaleHint")}
      </p>
      <ul className="mt-2 divide-y divide-stone-200">
        {unrated.map((row) => {
          const date = hiredOn(row);
          const meta = row.jobTitle
            ? date
              ? t("hireQueueRowMeta", { role: row.jobTitle, date })
              : row.jobTitle
            : date
              ? t("hireQueueRowHired", { date })
              : null;
          const busy = saving === row.entryId;
          return (
            <li key={row.entryId} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 py-2">
              <div className="min-w-0">
                <p className="truncate text-body font-medium text-ink">{row.candidateLabel}</p>
                {meta ? <p className="text-meta text-steel">{meta}</p> : null}
                {failed?.entryId === row.entryId ? (
                  <p role="alert" className="mt-0.5 text-sm text-red-700">
                    {failed.message}
                  </p>
                ) : null}
              </div>
              <div className={TOGGLE_GROUP} role="group" aria-label={t("hireQueueRowGroup", { name: row.candidateLabel })}>
                {HIRE_RATING_LEVELS.map((n) => (
                  <button
                    key={n}
                    type="button"
                    disabled={saving != null}
                    aria-label={t("hireQueueRateAria", { name: row.candidateLabel, n, max })}
                    onClick={() => void rate(row.entryId, n)}
                    className={`focus-ring rounded px-2.5 py-1 text-sm font-semibold nums transition-colors disabled:opacity-60 ${toggleBtn(false)}`}
                  >
                    {n}
                  </button>
                ))}
              </div>
              {busy ? <p className="w-full text-meta text-steel">{td("saving")}</p> : null}
            </li>
          );
        })}
      </ul>
      {unratedTotal > unrated.length ? (
        <p className="mt-2 text-meta text-steel">{t("hireQueueMore", { count: unratedTotal - unrated.length })}</p>
      ) : null}
      <p className="mt-2 text-meta leading-relaxed text-steel">{td("notAutomated")}</p>
    </details>
  );
}
