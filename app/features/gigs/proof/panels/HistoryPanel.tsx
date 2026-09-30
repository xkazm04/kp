"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Mark, Tag } from "@/app/_components/kit";
import type { GigAttempt, GigOutcome } from "@/app/_lib/gigs/types";
import { useGigsFormat } from "../../data/useGigsFormat";
import { attemptTimeline } from "../../logic/report";
import type { SpecialistRow } from "../../logic/wire";
import { OutcomeMark } from "../../shared/GigsMarks";
import { Panel } from "./Panel";
import type { GigRecord } from "./useGigRecord";

// Earlier drafts: every attempt, newest first - its status, cost, the note that sent it
// back, the fallback reason, the verdicts with the judge's words.

/** A long passage clamped to four lines, with Show all / Show less. */
function Clamp({ text, label }: { text: string; label: string }) {
  const t = useTranslations("gigs");
  const [open, setOpen] = useState(false);
  const long = text.length > 320;
  return (
    <blockquote className={`quote${long && !open ? " is-clamped" : ""}`}>
      <span className="quote-label">{label}</span>
      <span className="quote-text">{text}</span>
      {long ? (
        <button type="button" className="linkbtn" onClick={() => setOpen((v) => !v)}>
          {open ? t("tabs.showLess") : t("tabs.showAll")}
        </button>
      ) : null}
    </blockquote>
  );
}

export function HistoryPanel({ record, error, specialists }: { record: GigRecord | null; error: string | null; specialists: readonly SpecialistRow[] }) {
  const t = useTranslations("gigs");
  const fmt = useGigsFormat();
  if (error) {
    return (
      <Panel title={t("back.history")}>
        <p role="alert" className="alert">
          {error}
        </p>
      </Panel>
    );
  }
  if (!record) {
    return (
      <Panel title={t("back.history")}>
        <p className="panel-empty">{t("detail.loadingRecord")}</p>
      </Panel>
    );
  }
  const nameOf = (id: string) => specialists.find((s) => s.id === id)?.name ?? t("desk.theAgent");
  const A = record.attempts;
  const { rows, loose } = attemptTimeline(A, record.outcomes);
  const markOf = (s: GigAttempt["status"]) => (s === "failed" ? "fail" : s === "approved" || s === "sent" ? "ok" : s === "revision_requested" ? "caution" : s === "discarded" ? "bounce" : "wait");
  const verdictLine = (o: GigOutcome) => (
    <div key={o.id} className="tl-verdict">
      <OutcomeMark kind={o.verdict} /> <b>{fmt.verdict(o.verdict)}</b>
      <span className="tl-quiet">
        {t("detail.recorded", {
          date: fmt.dateTime(o.recordedAt),
          source: t(`outcomeSource.${o.source.replace(":", "_")}` as never),
        })}
      </span>
      {o.amount !== null ? <b>{fmt.money(o.amount, o.currency)}</b> : o.verdict === "accepted" ? <span className="absent">{t("detail.amountUnknown")}</span> : null}
      {o.feedbackText ? <Clamp text={o.feedbackText} label={t("tabs.judgeSaid")} /> : <span className="tl-quiet">{t("detail.noWords")}</span>}
    </div>
  );
  return (
    <Panel title={t("back.history")} sub={t("tabs.historySub", { count: A.length })}>
      {A.length === 0 ? (
        <p className="panel-empty">
          {t("detail.neverAttempted")}. {t("detail.neverAttemptedBody")}
        </p>
      ) : (
        <ol className="timeline">
          {rows.map(({ attempt: a, n, outcomes }) => {
            return (
              <li key={a.id} className={n === A.length ? "is-current" : undefined}>
                <span className="tl-dot">
                  <Mark kind={markOf(a.status)} tip={fmt.attemptStatus(a.status)} />
                </span>
                <div className="tl-card">
                  <div className="tl-head">
                    <b className="tl-name">{t("tabs.draftN", { n })}</b>
                    <span className={`status-pill is-${markOf(a.status)}`}>{fmt.attemptStatus(a.status)}</span>
                    {n === A.length ? <Tag label={t("tabs.thisDraft")} /> : null}
                    <span className="tl-cost">{a.costUsd === null ? <span className="absent">{t("signoff.costUnreported")}</span> : fmt.usd(a.costUsd)}</span>
                  </div>
                  <div className="tl-quiet">
                    {fmt.dateTime(a.createdAt)} · {nameOf(a.specialistId)}
                    {a.sentAt ? ` · ${t("detail.sentAt", { date: fmt.dateTime(a.sentAt) })}` : null}
                  </div>
                  {a.fallbackReason ? (
                    <p className="tl-fail">
                      {t("agentView.failedReason", {
                        reason: a.fallbackReason,
                      })}
                    </p>
                  ) : null}
                  {a.revisionNote ? <Clamp text={a.revisionNote} label={t("tabs.sentBackWith")} /> : null}
                  {a.status === "sent" && outcomes.length === 0 ? (
                    <div className="tl-verdict">
                      <OutcomeMark kind="pending" /> {t("mark.pending")}
                    </div>
                  ) : null}
                  {outcomes.map(verdictLine)}
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {loose.length ? <div className="tl-loose">{loose.map(verdictLine)}</div> : null}
    </Panel>
  );
}
