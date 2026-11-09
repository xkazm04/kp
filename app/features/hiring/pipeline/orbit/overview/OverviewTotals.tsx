"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { ABSENT } from "@/app/_components/kit";
import type { AutomationCounts } from "@/app/_lib/automation-counts";
import type { OrbitModel } from "../orbitModel";
import type { OrbitWords } from "../orbitWords";
import { slaTotals } from "./overviewModel";

/** Measured automated actions over the trailing week; null while loading or when the read failed (the
 *  figure is simply absent then: there is no estimate to fall back to, and a 0 would be a claim). */
function useAutomationCounts(): AutomationCounts | null {
  const [counts, setCounts] = useState<AutomationCounts | null>(null);
  useEffect(() => {
    const ctl = new AbortController();
    fetch("/api/pipeline/automation-counts", { signal: ctl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((p: Partial<AutomationCounts>) => {
        if (ctl.signal.aborted || typeof p.total !== "number") return;
        setCounts({ total: p.total, screens: p.screens ?? 0, outreach: p.outreach ?? 0, invites: p.invites ?? 0 });
      })
      .catch(() => { /* best-effort: a missing count hides the figure, it never blocks the Overview */ });
    return () => ctl.abort();
  }, []);
  return counts;
}

/**
 * The totals under the orbit: everyone active; how many of the people the clock measures are inside
 * their stage's SLA (a placed-never-moved person has no day count, so is not measured); hired (of the
 * target, when roles carry one); the open roles nobody is on yet and the drafts. Without the job list
 * the empty roles cannot be counted, so that figure is a dash with its reason, never a 0.
 *
 * Last, when there are any: what the automation DID in the last 7 days, counted from the event trail
 * (scores run, messages and invites sent, moves by the policy pass). Counts only, no hours and no money;
 * with nothing done yet, or no count read, the figure is absent rather than a 0.
 */
export function OverviewTotals({ model, words, jobsOk }: { model: OrbitModel; words: OrbitWords; jobsOk: boolean }) {
  const tl = useTranslations("overviewLit.totals");
  const { t, n } = words;
  const T = model.total;
  const sla = slaTotals(model.people);
  const auto = useAutomationCounts();
  const autoParts = auto
    ? [
        auto.screens > 0 ? tl("autoScreens", { count: auto.screens }) : null,
        auto.outreach > 0 ? tl("autoOutreach", { count: auto.outreach }) : null,
        auto.invites > 0 ? tl("autoInvites", { count: auto.invites }) : null,
      ].filter((x): x is string => x != null)
    : [];
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
      {auto && auto.total > 0 ? (
        <div data-role="overview-automated">
          <dt>{tl("automated")}</dt>
          <dd>{n(auto.total)}{autoParts.length ? <small> {autoParts.join(" · ")}</small> : null}</dd>
        </div>
      ) : null}
    </dl>
  );
}
