"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button, Mark, Tag } from "@/app/_components/kit";
import type { GigPlanRow } from "@/app/_lib/gigs/types";
import { useGigsFormat } from "../../data/useGigsFormat";
import { planDuration } from "../../logic/plans";
import { planSeatLabel } from "@/app/_lib/gigs/plan-seats";
import { PlanBody, PlanFailure } from "./PlanBody";

// One seat's figure panel in the report's plans section (report/ReportPlans.tsx): the seat, its state, what it cost
// (null = "cost not reported", never $0) and how long it took; then the plan, a quiet line
// while it is still being written, or the reason it failed. Under a ready plan, while
// nothing is accepted: an optional note and Accept this plan. Once one is accepted it is
// marked and the others are quieted but kept readable, so the comparison stays.

export type ColumnState = "open" | "accepted" | "quiet";

const MARK = { queued: "wait", running: "wait", ready: "ok", failed: "fail" } as const;

export function PlanColumn({
  row,
  state,
  busy,
  onAccept,
  onRetry,
}: {
  row: GigPlanRow;
  state: ColumnState;
  busy: boolean;
  /** Accept with the note; answers whether it landed. Absent = no accept offered. */
  onAccept: ((note: string) => Promise<boolean>) | null;
  /** A failed seat's Retry: a new round (Propose again). Absent while a seat still writes
   *  or a plan is accepted. */
  onRetry: (() => void) | null;
}) {
  const t = useTranslations("gigs.plans");
  const fmt = useGigsFormat();
  const [note, setNote] = useState("");
  const label = planSeatLabel(row);
  const status = t(`status.${row.status}`);
  const d = planDuration(row.durationMs);
  const cost = row.costUsd === null ? t("costNotReported") : fmt.usd(row.costUsd);
  const done = row.status === "ready" || row.status === "failed";

  return (
    <section className={`plan-col is-${state}`} aria-label={t("columnLabel", { seat: label, status })}>
      <header className="plan-head">
        <div className="plan-seat-row">
          <h4 className="plan-seat">{label}</h4>
          {state === "accepted" ? <Tag label={t("acceptedTag")} /> : null}
        </div>
        <p className="plan-meta">
          <Mark kind={MARK[row.status]} tip={status} />
          <span>{status}</span>
          {done ? (
            <>
              <span className="sep">·</span>
              <span className={row.costUsd === null ? "absent" : "strong"}>{cost}</span>
            </>
          ) : null}
          {done && d ? (
            <>
              <span className="sep">·</span>
              <span>{d.m > 0 ? t("durationM", { m: d.m, s: d.s }) : t("durationS", { s: d.s })}</span>
            </>
          ) : null}
        </p>
      </header>

      {row.status === "ready" && row.plan ? (
        <PlanBody plan={row.plan} />
      ) : row.status === "failed" ? (
        <div className="plan-failed">
          <PlanFailure reason={row.fallbackReason} />
          {onRetry ? <Button label={t("retry")} tip={t("retryTip")} size="sm" variant="secondary" disabled={busy} onClick={onRetry} /> : null}
        </div>
      ) : row.status === "ready" ? (
        <PlanFailure reason={null} />
      ) : (
        <p className="plan-quiet" role="status">
          {row.status === "running" ? t("writing") : t("queuedLine")}
        </p>
      )}

      {state === "accepted" ? (
        <div className="plan-accepted">
          <span className="caps dim">{t("acceptedOn", { date: fmt.date(row.acceptedAt) })}</span>
          {row.note ? (
            <p className="plan-note">
              <b>{t("yourNote")}</b> {row.note}
            </p>
          ) : null}
        </div>
      ) : onAccept && row.status === "ready" && row.plan ? (
        <form
          className="plan-accept"
          onSubmit={(e) => {
            e.preventDefault();
            void onAccept(note).then((ok) => ok && setNote(""));
          }}
        >
          <textarea className="field" value={note} maxLength={2000} rows={2} aria-label={t("noteLabel")} placeholder={t("notePlaceholder")} onChange={(e) => setNote(e.target.value)} />
          <Button label={t("accept")} variant="affirm" disabled={busy} type="submit" />
        </form>
      ) : null}
    </section>
  );
}
