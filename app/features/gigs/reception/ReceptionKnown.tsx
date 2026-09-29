"use client";

import { useTranslations } from "next-intl";
import type { GigKpi, GigKpiCell } from "@/app/_lib/gigs/types";
import type { AttemptTally } from "../logic/niches";
import { useGigsFormat } from "../data/useGigsFormat";

/** Attempt statuses in the order the stack is drawn: the ones that cost a round first. */
const STACK_ORDER = ["revision_requested", "failed", "drafted", "approved", "sent", "running", "dispatched", "discarded"] as const;

/** What is known beside the ledger: the program's attempts as a stack, its cost (an
 *  unreported cost is a count, never free), money won per currency (never added up), what
 *  was sent, and the disclosure rate. */
export function ReceptionKnown({ kpi, program, sent, overall }: { kpi: GigKpi; program: AttemptTally; sent: number; overall: GigKpiCell }) {
  const t = useTranslations("gigs");
  const fmt = useGigsFormat();
  const stack = STACK_ORDER.map((s) => ({ s, n: program.byStatus[s] ?? 0 })).filter((x) => x.n > 0);
  const stackSpoken = stack.map((x) => `${x.n} ${fmt.attemptStatus(x.s)}`).join(", ");

  return (
    <div className="known" aria-label={t("reception.knownLabel")}>
      <div className="k">
        <span className="caps dim">{t("reception.attempts")}</span>
        <span className="fig">{program.attempts}</span>
        {program.attempts === 0 ? (
          <span className="t-meta">{t("reception.noAttempts")}</span>
        ) : (
          <>
            <div className="stack" role="img" aria-label={t("reception.stackLabel", { list: stackSpoken })}>
              {stack.map((x) => (
                <i key={x.s} className={`s-${x.s}`} style={{ flex: x.n }} />
              ))}
            </div>
            <div className="legend">
              {stack.map((x) => (
                <span key={x.s}>
                  <i className={`s-${x.s}`} aria-hidden />
                  <b>{x.n}</b> {fmt.attemptStatus(x.s).toLowerCase()}
                </span>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="k">
        <span className="caps dim">{t("reception.cost")}</span>
        <span className="fig">{fmt.usd(program.costUsd)}</span>
        <span className="t-meta">{program.costUnreported > 0 ? t("reception.costLowerBound", { count: program.costUnreported }) : t("reception.costAll")}</span>
      </div>

      <div className="k">
        <span className="caps dim">{t("reception.money")}</span>
        {kpi.moneyWon.length === 0 ? (
          <>
            <span className="fig words dash">{t("reception.noneRecorded")}</span>
            <span className="t-meta">{t("reception.moneyRule")}</span>
          </>
        ) : (
          <>
            {kpi.moneyWon.map((m) => (
              <span key={m.currency ?? "none"} className="flex items-baseline justify-between gap-3">
                <span className="fig words">{fmt.money(m.amount, m.currency)}</span>
                <span className="t-meta">{t("scorecard.moneyCount", { count: m.count })}</span>
              </span>
            ))}
            <span className="t-meta">{t("scorecard.noTotal")}</span>
          </>
        )}
        {kpi.acceptedWithoutAmount > 0 ? <span className="t-meta">{t("scorecard.acceptedNoAmount", { count: kpi.acceptedWithoutAmount })}</span> : null}
      </div>

      <div className="k">
        <span className="caps dim">{t("reception.sent")}</span>
        <span className="fig">{sent}</span>
        <span className="t-meta">{sent === 0 ? t("reception.sentZero") : t("reception.sentSome", { pending: overall.pending })}</span>
      </div>

      <div className="k">
        <span className="caps dim">{t("reception.disclosure")}</span>
        {kpi.disclosureRate === null ? (
          <>
            <span className="fig dash" aria-label={t("reception.disclosureNone")}>
              —
            </span>
            <span className="t-meta">{t("reception.disclosureNone")}</span>
          </>
        ) : (
          <>
            <span className="fig">{fmt.percent(Math.round(kpi.disclosureRate * 100))}</span>
            <span className="t-meta">{t("scorecard.disclosureNote")}</span>
          </>
        )}
      </div>

      <p className="t-meta computed">
        {t("scorecard.computedAt", { date: fmt.dateTime(kpi.computedAt) })}
      </p>
    </div>
  );
}
