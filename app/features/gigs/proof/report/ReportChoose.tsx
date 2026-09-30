"use client";

import { useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/app/_components/kit";
import { LoadingGap } from "@/app/_components/ui/LoadingGap";
import { planSeatLabel, planSeatsFor } from "@/app/_lib/gigs/plan-seats";
import type { Gig, GigPlanRow } from "@/app/_lib/gigs/types";
import { useErrorMessage, type ApiErrorPayload } from "@/app/_lib/use-error-message";
import { useGigsFormat } from "../../data/useGigsFormat";
import { planView } from "../../logic/plans";
import { usePlanActions, type PlansState } from "../panels/usePlans";
import { SeatCard } from "./SeatCard";

// The Summary's plan block (gig-mastery S1, docs/features/gigs/README.md "The Gigs tab").
// While nothing is accepted: "Choose a plan" - the lineup the brief's difficulty decides
// (app/_lib/gigs/plan-seats.ts planSeatsFor: one plan up to a hard gig, three for a very
// hard one) as compact seat cards, each with Accept and an optional note that rides into the
// agent's assignment; no plans yet = Generate plans, saying which models write. Once one is
// accepted the block is a single line - the seat and the note - over its steps' titles.
// Plans compared in full live in the report file.

const list = (items: string[], locale: string) => new Intl.ListFormat(locale, { type: "conjunction" }).format(items);

export function ReportChoose({ gig, plansState, onFlash }: { gig: Gig; plansState: PlansState; onFlash: (message: string) => void }) {
  const t = useTranslations("gigs");
  const locale = useLocale();
  const fmt = useGigsFormat();
  const resolveError = useErrorMessage();
  const { plans, failure } = plansState;
  const view = useMemo(() => planView(plans), [plans]);
  const lineup = planSeatsFor(gig.brief?.difficulty).map((s) => s.label);
  const act = usePlanActions(gig.id, plansState, onFlash, lineup.length);
  const canPropose = gig.brief !== null && view.accepted === null && !view.busy;
  const alert = (text: string | null) =>
    text ? (
      <p role="alert" className="alert gap-below">
        {text}
      </p>
    ) : null;
  const loadAlert = failure ? resolveError(failure as ApiErrorPayload, t("plans.loadFailed")) : null;

  if (view.accepted) return <AcceptedLine row={view.accepted} />;
  if (plans === null) return loadAlert ? alert(loadAlert) : <LoadingGap className="min-h-[6rem]" label={t("plans.loading")} />;

  const lineupLine = gig.brief ? t("report.choose.lineup", { difficulty: t(`brief.level.${gig.brief.difficulty}`), count: lineup.length, models: list(lineup, locale) }) : "";
  if (!view.shown) {
    return (
      <div className="choose-empty">
        {alert(act.error)}
        {alert(loadAlert)}
        <p className="choose-title">{t("plans.emptyTitle")}</p>
        <p className="choose-line">{lineupLine}</p>
        <p className="t-meta">{t("report.choose.gate")}</p>
        <Button label={t("report.choose.generate")} variant="primary" disabled={act.busy || view.busy || !gig.brief} onClick={() => void act.propose()} />
      </div>
    );
  }

  const rows = view.shown.rows;
  return (
    <>
      {alert(act.error)}
      {alert(loadAlert)}
      <div className="choose-bar">
        <p className="t-meta">
          {t("plans.roundOf", { date: fmt.dateTime(view.shown.createdAt) })} · {t("report.choose.inFile")}
        </p>
        {canPropose ? <Button label={t("plans.proposeAgain")} tip={lineupLine} size="sm" variant="secondary" disabled={act.busy} onClick={() => void act.propose()} /> : null}
      </div>
      <div className={`seats n-${Math.min(3, rows.length)}`}>
        {rows.map((row) => (
          <SeatCard key={row.id} row={row} busy={act.busy} onAccept={(note) => act.accept(row.id, note)} onRetry={canPropose ? () => void act.propose() : null} />
        ))}
      </div>
    </>
  );
}

/** The accepted plan in one line (the seat, the operator's note) over its steps' titles. */
function AcceptedLine({ row }: { row: GigPlanRow }) {
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
