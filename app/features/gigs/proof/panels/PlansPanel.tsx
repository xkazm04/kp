"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/app/_components/kit";
import { LoadingGap } from "@/app/_components/ui/LoadingGap";
import { useErrorMessage, type ApiErrorPayload } from "@/app/_lib/use-error-message";
import type { Gig } from "@/app/_lib/gigs/types";
import { sendJson } from "../../data/useGigsData";
import { useGigsFormat } from "../../data/useGigsFormat";
import { planView } from "../../logic/plans";
import { Panel } from "./Panel";
import { PlanBody, PlanFailure, seatLabel } from "./PlanBody";
import { PlanColumn } from "./PlanColumn";
import type { PlansState } from "./usePlans";

// Plans (gig-mastery S1, docs/features/gigs/README.md "The Gigs tab"): three models each
// write a plan for the gig - Fable 5, Opus 5.5 at extra-high effort, Sonnet 5.5 at high
// effort (app/_lib/gigs/plan-seats.ts) - shown side by side, and the operator accepts
// exactly one, with an optional note that rides into the agent's assignment. Only an
// accepted plan can be dispatched (the sign-off says so). Propose again is offered while
// nothing is accepted; a failed seat's Retry is the same door (a new round). The rows are
// read by the proof (usePlans.ts, re-polled while a seat writes) and shared with the tab
// row and the sign-off. Earlier rounds fold under the columns, read-only.

export function PlansPanel({ gig, plansState, onFlash }: { gig: Gig; plansState: PlansState; onFlash: (message: string) => void }) {
  const t = useTranslations("gigs.plans");
  const fmt = useGigsFormat();
  const resolveError = useErrorMessage();
  const { plans, failure, reload, expectRound } = plansState;
  const view = useMemo(() => planView(plans), [plans]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const base = `/api/gigs/${encodeURIComponent(gig.id)}/plans`;

  async function propose() {
    setBusy(true);
    setError(null);
    const res = await sendJson(base, "POST", {});
    setBusy(false);
    if (!res.ok) {
      setError(resolveError(res.body as ApiErrorPayload | null, t("proposeFailed")));
      return;
    }
    expectRound();
    onFlash(t("proposedFlash"));
    await reload();
  }

  async function accept(planId: string, note: string): Promise<boolean> {
    setBusy(true);
    setError(null);
    const res = await sendJson(`${base}/${encodeURIComponent(planId)}/accept`, "POST", { note });
    setBusy(false);
    if (!res.ok) {
      setError(resolveError(res.body as ApiErrorPayload | null, t("acceptFailed")));
      await reload();
      return false;
    }
    onFlash(t("acceptedFlash"));
    await reload();
    return true;
  }

  const canPropose = gig.brief !== null && view.accepted === null && !view.busy;
  const proposeAgain = canPropose && view.shown ? <Button label={t("proposeAgain")} size="sm" variant="secondary" disabled={busy} onClick={() => void propose()} /> : null;

  return (
    <Panel title={t("title")} sub={view.shown ? t("roundOf", { date: fmt.dateTime(view.shown.createdAt) }) : undefined} actions={proposeAgain}>
      {error ? (
        <p role="alert" className="alert gap-below">
          {error}
        </p>
      ) : null}
      {failure ? (
        <p role="alert" className="alert gap-below">
          {resolveError(failure as ApiErrorPayload, t("loadFailed"))}
        </p>
      ) : null}

      {gig.brief === null ? (
        <p className="panel-empty">{t("noBrief")}</p>
      ) : plans === null ? (
        failure ? null : <LoadingGap className="min-h-[12rem]" label={t("loading")} />
      ) : !view.shown ? (
        <div className="plan-empty">
          <p className="plan-empty-title">{t("emptyTitle")}</p>
          <p className="plan-empty-body">{t("what")}</p>
          <p className="t-meta">{t("cost")}</p>
          <Button label={t("propose")} variant="primary" disabled={busy || view.busy} onClick={() => void propose()} />
        </div>
      ) : (
        <div className="plan-cols">
          {view.shown.rows.map((row) => (
            <PlanColumn
              key={row.id}
              row={row}
              state={view.accepted ? (view.accepted.id === row.id ? "accepted" : "quiet") : "open"}
              busy={busy}
              onAccept={view.accepted ? null : (note) => accept(row.id, note)}
              onRetry={canPropose ? () => void propose() : null}
            />
          ))}
        </div>
      )}

      {view.earlier.length > 0 ? (
        <details className="plan-earlier">
          <summary>{t("earlier", { count: view.earlier.length })}</summary>
          <ul>
            {view.earlier.flatMap((round) =>
              round.rows.map((row) => (
                <li key={row.id}>
                  <details className="fold-inline">
                    <summary>{t("earlierRow", { date: fmt.dateTime(round.createdAt), seat: seatLabel(row), status: t(`status.${row.status}`) })}</summary>
                    {row.status === "ready" && row.plan ? <PlanBody plan={row.plan} /> : <PlanFailure reason={row.status === "failed" ? row.fallbackReason : null} />}
                  </details>
                </li>
              ))
            )}
          </ul>
        </details>
      ) : null}
    </Panel>
  );
}
