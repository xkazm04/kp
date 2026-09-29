"use client";

import { useTranslations } from "next-intl";
import { GIG_PLAN_SEATS } from "@/app/_lib/gigs/plan-seats";
import type { GigPlan, GigPlanRow } from "@/app/_lib/gigs/types";
import { planFailure } from "../../logic/plans";

// A plan as its seat wrote it, read-only (PlanColumn.tsx, and the earlier rounds' fold in
// PlansPanel.tsx): the summary at a reading size, the numbered steps each with its "Done
// when", then what the plan decided without saying so, its risks, its effort and the
// questions it has for the operator. An empty list is left out, never shown as "none".

export function seatLabel(row: Pick<GigPlanRow, "seat" | "model">): string {
  return GIG_PLAN_SEATS.find((s) => s.seat === row.seat)?.label ?? row.model;
}

function List({ title, items }: { title: string; items: readonly string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="plan-list">
      <h5 className="plan-sub">{title}</h5>
      <ul>
        {items.map((x, i) => (
          <li key={i}>{x}</li>
        ))}
      </ul>
    </div>
  );
}

export function PlanBody({ plan }: { plan: GigPlan }) {
  const t = useTranslations("gigs.plans");
  const e = plan.effortHours;
  const effort = e === null ? null : e.min === e.max ? t("effortOne", { n: e.min }) : t("effortRange", { min: e.min, max: e.max });
  return (
    <div className="plan-body">
      <p className="plan-summary">{plan.summary}</p>
      <div className="plan-list">
        <h5 className="plan-sub">{t("steps")}</h5>
        <ol className="plan-steps">
          {plan.steps.map((s, i) => (
            <li key={i}>
              <span className="plan-n" aria-hidden>
                {i + 1}
              </span>
              <div className="plan-step">
                <span className="plan-step-title">{s.title}</span>
                <span className="plan-done">
                  <b>{t("doneWhen")}</b> {s.doneWhen}
                </span>
              </div>
            </li>
          ))}
        </ol>
      </div>
      <List title={t("decisions")} items={plan.decisions} />
      <List title={t("risks")} items={plan.risks} />
      {effort ? (
        <div className="plan-list">
          <h5 className="plan-sub">{t("effort")}</h5>
          <p className="plan-effort">{effort}</p>
        </div>
      ) : null}
      <List title={t("questions")} items={plan.questions} />
    </div>
  );
}

/** Why a seat wrote no plan, in words; a code the catalog does not know is shown as itself. */
export function PlanFailure({ reason }: { reason: string | null }) {
  const t = useTranslations("gigs.plans");
  const f = planFailure(reason);
  return (
    <p className="plan-fail">
      {f.key ? t(`reason.${f.key}`) : f.detail ? t("reason.other") : t("reason.none")}
      {f.detail ? <code className="plan-code">{f.detail}</code> : null}
    </p>
  );
}
