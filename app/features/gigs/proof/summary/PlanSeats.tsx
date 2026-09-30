"use client";

import { useLocale, useTranslations } from "next-intl";
import { LoadingGap } from "@/app/_components/ui/LoadingGap";
import { planSeatLabel } from "@/app/_lib/gigs/plan-seats";
import type { Gig, GigPlanRow } from "@/app/_lib/gigs/types";
import { useErrorMessage, type ApiErrorPayload } from "@/app/_lib/use-error-message";
import { useGigsFormat } from "../../data/useGigsFormat";
import { SeatCard } from "../report/SeatCard";
import type { SummaryKit } from "./useSummaryKit";

// The Summary's Plans panel (gig-mastery S1, docs/features/gigs/README.md "The Gigs tab").
// While nothing is accepted: the lineup the brief's difficulty decides
// (app/_lib/gigs/plan-seats.ts planSeatsFor: one plan up to a hard gig, three for a very hard
// one) as compact seat cards, each with its note and Accept this plan (a choice belongs to its
// option), a failed seat with Retry; Generate plans and Propose again live in the sidebar's
// Moves block. Once one is accepted the panel is a single line - the seat and the note - over
// its steps' titles. Plans compared in full live in the report file.

const list = (items: string[], locale: string) => new Intl.ListFormat(locale, { type: "conjunction" }).format(items);

export function PlanSeats({ gig, kit }: { gig: Gig; kit: SummaryKit }) {
  const t = useTranslations("gigs");
  const locale = useLocale();
  const fmt = useGigsFormat();
  const resolveError = useErrorMessage();
  const { plans, failure } = kit.plansState;
  const { view, planAct, lineup } = kit;
  const brief = kit.research.brief ?? gig.brief;
  const canPropose = brief !== null && view.accepted === null && !view.busy;
  const alert = (text: string | null) =>
    text ? (
      <p role="alert" className="alert gap-below">
        {text}
      </p>
    ) : null;
  const loadAlert = failure ? resolveError(failure as ApiErrorPayload, t("plans.loadFailed")) : null;

  if (view.accepted) return <AcceptedLine row={view.accepted} />;
  if (plans === null) return loadAlert ? alert(loadAlert) : <LoadingGap className="min-h-[6rem]" label={t("plans.loading")} />;
  if (!view.shown) {
    return (
      <div className="choose-empty">
        {alert(planAct.error)}
        <p className="choose-title">{t("plans.emptyTitle")}</p>
        {brief ? <p className="choose-line">{t("report.choose.lineup", { difficulty: t(`brief.level.${brief.difficulty}`), count: lineup.length, models: list(lineup, locale) })}</p> : null}
        <p className="choose-line">{t("report.choose.gate")}</p>
        <p className="t-meta">{t("summary.plansHint")}</p>
      </div>
    );
  }
  return (
    <>
      {alert(planAct.error)}
      {alert(loadAlert)}
      <p className="t-meta gap-below">
        {t("plans.roundOf", { date: fmt.dateTime(view.shown.createdAt) })} · {t("report.choose.inFile")}
      </p>
      <div className={`seats n-${Math.min(3, view.shown.rows.length)}`}>
        {view.shown.rows.map((row) => (
          <SeatCard key={row.id} row={row} busy={planAct.busy} onAccept={(note) => planAct.accept(row.id, note)} onRetry={canPropose ? () => void planAct.propose() : null} />
        ))}
      </div>
    </>
  );
}

/** The accepted plan in one line (the seat, the operator's note) over its steps' titles. */
export function AcceptedLine({ row }: { row: GigPlanRow }) {
  const t = useTranslations("gigs");
  const fmt = useGigsFormat();
  const steps = row.plan?.steps ?? [];
  return (
    <div className="accepted" aria-label={t("report.choose.acceptedLabel")} role="group">
      <p className="accepted-line">
        <b>{t("report.choose.acceptedLine", { seat: planSeatLabel(row) })}</b>
        {row.note ? <span className="accepted-note">, {row.note}</span> : null}
      </p>
      <p className="t-meta">{t("plans.acceptedOn", { date: fmt.date(row.acceptedAt) })}</p>
      {steps.length ? (
        <ol className="accepted-steps">
          {steps.map((s, i) => (
            <li key={i}>{s.title}</li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}
