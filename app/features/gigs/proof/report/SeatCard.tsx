"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button, Mark } from "@/app/_components/kit";
import { planSeatLabel } from "@/app/_lib/gigs/plan-seats";
import type { GigPlanRow } from "@/app/_lib/gigs/types";
import { useGigsFormat } from "../../data/useGigsFormat";
import { planFailure } from "../../logic/plans";
import { firstSentence } from "../../logic/report";

// One seat's plan as a compact card in the Summary's Plans panel (summary/PlanSeats.tsx): the
// seat, its state as a mark AND a word, what it cost (null = "cost not reported", never $0),
// the summary's first sentence, how many steps and how many hours. The whole plan - steps,
// decisions, risks, questions - is in the report file; the card is for picking. A ready
// plan takes an optional note and Accept this plan; a failed seat says why, with Retry.

const MARK = { queued: "wait", running: "wait", ready: "ok", failed: "fail" } as const;

export function SeatCard({ row, busy, onAccept, onRetry }: { row: GigPlanRow; busy: boolean; onAccept: (note: string) => Promise<boolean>; onRetry: (() => void) | null }) {
  const t = useTranslations("gigs.plans");
  const fmt = useGigsFormat();
  const [note, setNote] = useState("");
  const label = planSeatLabel(row);
  const status = t(`status.${row.status}`);
  const plan = row.status === "ready" ? row.plan : null;
  const e = plan?.effortHours ?? null;
  const facts = plan
    ? [t("stepCount", { count: plan.steps.length }), e === null ? null : e.min === e.max ? t("effortOne", { n: e.min }) : t("effortRange", { min: e.min, max: e.max })].filter(Boolean).join(" · ")
    : null;
  const failure = planFailure(row.fallbackReason);

  return (
    <section className={`seat is-${row.status}`} aria-label={t("columnLabel", { seat: label, status })}>
      <header className="seat-head">
        <h4 className="seat-name">{label}</h4>
        <p className="seat-meta">
          <Mark kind={MARK[row.status]} />
          <span>{status}</span>
          {row.status === "ready" || row.status === "failed" ? (
            <>
              <span className="sep">·</span>
              <span className={row.costUsd === null ? "absent" : "strong"}>{row.costUsd === null ? t("costNotReported") : fmt.usd(row.costUsd)}</span>
            </>
          ) : null}
        </p>
      </header>

      {plan ? (
        <>
          <p className="seat-gist">{firstSentence(plan.summary)}</p>
          {facts ? <p className="seat-facts">{facts}</p> : null}
          <form
            className="seat-accept"
            onSubmit={(ev) => {
              ev.preventDefault();
              void onAccept(note).then((ok) => ok && setNote(""));
            }}
          >
            <textarea className="field" value={note} maxLength={2000} rows={2} aria-label={t("noteLabel")} placeholder={t("notePlaceholder")} onChange={(ev) => setNote(ev.target.value)} />
            <Button label={t("accept")} variant="affirm" disabled={busy} type="submit" />
          </form>
        </>
      ) : row.status === "failed" ? (
        <div className="seat-failed">
          <p className="plan-fail">
            {failure.key ? t(`reason.${failure.key}`) : failure.detail ? t("reason.other") : t("reason.none")}
            {failure.detail ? <code className="plan-code">{failure.detail}</code> : null}
          </p>
          {onRetry ? <Button label={t("retry")} tip={t("retryTip")} size="sm" variant="secondary" disabled={busy} onClick={onRetry} /> : null}
        </div>
      ) : row.status === "ready" ? (
        <p className="plan-fail">{t("reason.none")}</p>
      ) : (
        <p className="seat-quiet" role="status">
          {row.status === "running" ? t("writing") : t("queuedLine")}
        </p>
      )}
    </section>
  );
}
