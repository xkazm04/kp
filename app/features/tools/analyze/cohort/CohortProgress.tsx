"use client";

// The quiet progress line above a comparison: the seats filling as members land (in their
// neutral order, so a seat never jumps), the status word, and the counts in one sentence. A
// polite live region: a screen reader hears the count move, never every seat.
import { useMemo } from "react";
import { useTranslations } from "next-intl";
import type { CohortView } from "./cohortTypes";
import { CohortSeats, SeatKey, type SeatTone } from "./CohortSeats";

export function CohortProgress({ view }: { view: CohortView }) {
  const t = useTranslations("analyzeCohort.shell.progress");
  const { total, done, reused, failed } = view.progress;
  const seats = useMemo(
    () =>
      [...view.members]
        .sort((a, b) => a.neutralIndex - b.neutralIndex)
        .map((m) => ({ key: m.memberId, tone: m.runState as SeatTone })),
    [view.members]
  );
  const line = t("line", { done, total, reused, failed });
  const settled = view.status === "done" || view.status === "failed";
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2" data-cohort-progress={view.status}>
      <CohortSeats seats={seats} cap={total} label={line} />
      <p role="status" aria-live="polite" className="text-body text-ink">
        <span className="font-semibold">{t(`status.${view.status}`)}</span>
        <span className="text-steel"> · </span>
        {line}
      </p>
      {settled ? null : (
        <span className="flex flex-wrap gap-x-3 gap-y-1" aria-hidden>
          <SeatKey tone="done">{t("key.done")}</SeatKey>
          <SeatKey tone="reused">{t("key.reused")}</SeatKey>
          <SeatKey tone="analyzing">{t("key.analyzing")}</SeatKey>
          <SeatKey tone="queued">{t("key.queued")}</SeatKey>
          {failed > 0 ? <SeatKey tone="failed">{t("key.failed")}</SeatKey> : null}
        </span>
      )}
    </div>
  );
}
