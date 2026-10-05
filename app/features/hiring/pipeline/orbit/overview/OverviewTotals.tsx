"use client";

import { useTranslations } from "next-intl";
import { ABSENT } from "@/app/_components/kit";
import type { OrbitModel } from "../orbitModel";
import type { OrbitWords } from "../orbitWords";
import { slaTotals } from "./overviewModel";

/**
 * The totals under the orbit: everyone active; how many of the people the clock measures are inside
 * their stage's SLA (a placed-never-moved person has no day count, so is not measured); hired (of the
 * target, when roles carry one); the open roles nobody is on yet and the drafts. Without the job list
 * the empty roles cannot be counted, so that figure is a dash with its reason, never a 0.
 */
export function OverviewTotals({ model, words, jobsOk }: { model: OrbitModel; words: OrbitWords; jobsOk: boolean }) {
  const tl = useTranslations("overviewLit.totals");
  const { t, n } = words;
  const T = model.total;
  const sla = slaTotals(model.people);
  return (
    <dl className="ov-totals" aria-label={tl("aria")}>
      <div>
        <dt>{tl("active")}</dt>
        <dd>{n(T.act)}</dd>
      </div>
      <div>
        <dt>{tl("inside", { over: sla.over })}</dt>
        <dd>{n(sla.inside)} <small>{tl("insideOf", { measured: sla.measured })}</small></dd>
      </div>
      <div>
        <dt>{tl("hired")}</dt>
        <dd>{n(T.hired)}{T.target ? <small> {tl("hiredOf", { target: T.target })}</small> : null}</dd>
      </div>
      <div>
        <dt>{tl("open")}</dt>
        {jobsOk ? (
          <dd>{n(T.abs.vacant)}{T.abs.draft ? <small> {tl("drafts", { count: T.abs.draft })}</small> : null}</dd>
        ) : (
          <>
            <dd>{ABSENT}</dd>
            <dd className="ov-totals__why">{t("legendNoJobs")}</dd>
          </>
        )}
      </div>
    </dl>
  );
}
