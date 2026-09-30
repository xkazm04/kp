"use client";

import { useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/app/_components/kit";
import { LoadingGap } from "@/app/_components/ui/LoadingGap";
import { planSeatLabel, planSeatsFor } from "@/app/_lib/gigs/plan-seats";
import type { Gig } from "@/app/_lib/gigs/types";
import { useErrorMessage, type ApiErrorPayload } from "@/app/_lib/use-error-message";
import { useGigsFormat } from "../../data/useGigsFormat";
import { planView } from "../../logic/plans";
import type { AfterWrite } from "../../logic/wire";
import { PlanBody, PlanFailure } from "../panels/PlanBody";
import { PlanColumn } from "../panels/PlanColumn";
import { usePlanActions, type PlansState } from "../panels/usePlans";
import { useResearch } from "../panels/useResearch";
import { Callout, Figure } from "./parts";

// Section 3, the plans (gig-mastery S1, docs/features/gigs/README.md "The Gigs tab"): the
// brief's difficulty decides the lineup (app/_lib/gigs/plan-seats.ts planSeatsFor) - one
// plan up to a hard gig, three competing ones for a very hard gig - set side by side as
// figure panels, one column per seat. The operator accepts exactly one, with an optional
// note that rides into the agent's assignment; only an accepted plan can be dispatched.
// No brief yet: Research first. No plans yet: Generate plans, saying which models write.
// Earlier rounds fold under the columns, read-only.

const list = (items: string[], locale: string) => new Intl.ListFormat(locale, { type: "conjunction" }).format(items);

export function ReportPlans({ gig, plansState, figure, onChanged, onFlash }: { gig: Gig; plansState: PlansState; figure: number; onChanged: AfterWrite; onFlash: (message: string) => void }) {
  const t = useTranslations("gigs");
  const locale = useLocale();
  const fmt = useGigsFormat();
  const resolveError = useErrorMessage();
  const { plans, failure } = plansState;
  const view = useMemo(() => planView(plans), [plans]);
  const lineup = planSeatsFor(gig.brief?.difficulty).map((s) => s.label);
  const act = usePlanActions(gig.id, plansState, onFlash, lineup.length);
  const research = useResearch(gig, onChanged);
  const canPropose = gig.brief !== null && view.accepted === null && !view.busy;
  const alert = (text: string | null) =>
    text ? (
      <p role="alert" className="alert gap-below">
        {text}
      </p>
    ) : null;

  if (!gig.brief) {
    return (
      <Callout tone="steel" label={t("report.plans.researchFirst")}>
        <p>{t("report.plans.researchBody")}</p>
        <Button label={t("brief.research")} loading={research.busy} loadingLabel={t("brief.researching")} variant="primary" onClick={() => void research.research()} />
        {alert(research.error)}
      </Callout>
    );
  }

  const lineupLine = t("report.plans.lineup", { difficulty: t(`brief.level.${gig.brief.difficulty}`), count: lineup.length, models: list(lineup, locale) });
  if (plans === null) return failure ? alert(resolveError(failure as ApiErrorPayload, t("plans.loadFailed"))) : <LoadingGap className="min-h-[12rem]" label={t("plans.loading")} />;

  if (!view.shown) {
    return (
      <div className="rp-generate">
        {alert(act.error)}
        {alert(failure ? resolveError(failure as ApiErrorPayload, t("plans.loadFailed")) : null)}
        <p className="rp-generate-t">{t("plans.emptyTitle")}</p>
        <p className="rp-generate-b">{lineupLine}</p>
        <p className="t-meta">{t("report.plans.gate")}</p>
        <Button label={t("report.plans.generate")} variant="primary" disabled={act.busy || view.busy} onClick={() => void act.propose()} />
      </div>
    );
  }

  const rows = view.shown.rows;
  const seats = rows.map((r) => planSeatLabel(r));
  return (
    <>
      {alert(act.error)}
      {alert(failure ? resolveError(failure as ApiErrorPayload, t("plans.loadFailed")) : null)}
      <div className="rp-plans-bar">
        <p className="t-meta">{t("plans.roundOf", { date: fmt.dateTime(view.shown.createdAt) })}</p>
        {canPropose ? <Button label={t("plans.proposeAgain")} tip={lineupLine} size="sm" variant="secondary" disabled={act.busy} onClick={() => void act.propose()} /> : null}
      </div>
      <Figure n={figure} what={t("report.plans.caption", { count: rows.length })} source={t("report.plans.source", { models: list(seats, locale) })} plain>
        <div className={`plan-cols cols-${Math.min(3, rows.length)}`}>
          {rows.map((row) => (
            <PlanColumn
              key={row.id}
              row={row}
              state={view.accepted ? (view.accepted.id === row.id ? "accepted" : "quiet") : "open"}
              busy={act.busy}
              onAccept={view.accepted ? null : (note) => act.accept(row.id, note)}
              onRetry={canPropose ? () => void act.propose() : null}
            />
          ))}
        </div>
      </Figure>
      {view.earlier.length > 0 ? (
        <details className="plan-earlier">
          <summary>{t("plans.earlier", { count: view.earlier.length })}</summary>
          <ul>
            {view.earlier.flatMap((round) =>
              round.rows.map((row) => (
                <li key={row.id}>
                  <details className="fold-inline">
                    <summary>{t("plans.earlierRow", { date: fmt.dateTime(round.createdAt), seat: planSeatLabel(row), status: t(`plans.status.${row.status}`) })}</summary>
                    {row.status === "ready" && row.plan ? <PlanBody plan={row.plan} /> : <PlanFailure reason={row.status === "failed" ? row.fallbackReason : null} />}
                  </details>
                </li>
              ))
            )}
          </ul>
        </details>
      ) : null}
    </>
  );
}
