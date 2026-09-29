"use client";

import { useTranslations } from "next-intl";
import { Button, Mark, Tag } from "@/app/_components/kit";
import type { Gig } from "@/app/_lib/gigs/types";
import { QUALIFY_BAR } from "../../logic/rate";
import type { RoutingView } from "../../logic/routing";

// The routing tab's two cards: who the gig goes to (and how it got there), and its fit
// against the qualification bar with the four factors behind the score.

export function RouteCards({ gig, view, busy, onUnroute, onOpenLane }: { gig: Gig; view: RoutingView; busy: boolean; onUnroute: () => void; onOpenLane: () => void }) {
  const t = useTranslations("gigs");
  const q = gig.qualification;
  const yesNo = (v: boolean) => (v ? t("triageView.yes") : t("triageView.no"));
  const factors = q
    ? [
        { key: "arenaFit", ok: q.factors.arenaFit, label: t("triageView.arenaFit"), value: yesNo(q.factors.arenaFit) },
        { key: "rewardKnown", ok: q.factors.rewardKnown, label: t("triageView.rewardKnown"), value: yesNo(q.factors.rewardKnown) },
        {
          key: "headroom",
          ok: q.factors.deadlineHeadroomDays !== null && q.factors.deadlineHeadroomDays > 0,
          label: t("triageView.headroom"),
          value: q.factors.deadlineHeadroomDays === null ? t("facts.noDeadline") : t("triageView.days", { days: q.factors.deadlineHeadroomDays }),
        },
        { key: "available", ok: q.factors.specialistAvailable, label: t("triageView.specialistAvailable"), value: yesNo(q.factors.specialistAvailable) },
      ]
    : [];

  return (
    <div className="route-grid">
      <section className="route-card">
        <span className="caps dim">{t("routing.goesTo")}</span>
        {view.current ? (
          <>
            <p className="route-big">{view.current.spec.niche}</p>
            <p className="route-quiet">{view.current.name}</p>
            <div className="route-row">
              <Tag label={view.routed ? t("routing.routedByYou") : t("routing.autoMatched")} />
            </div>
          </>
        ) : (
          <p className="route-big absent">{t("routing.noneMatched")}</p>
        )}
        <div className="route-acts">
          {view.routed && !view.lock ? <Button label={t("routing.autoMatch")} size="sm" variant="secondary" disabled={busy} onClick={onUnroute} /> : null}
          <Button label={t("back.inLanes")} size="sm" variant="ghost" onClick={onOpenLane} />
        </div>
        {view.lock ? <p className="route-note">{t(`routing.locked.${view.lock}`)}</p> : null}
      </section>
      <section className="route-card">
        <span className="caps dim">{t("back.fitScore")}</span>
        {q ? (
          <>
            <p className="route-big">
              {q.score}
              <span className="route-of"> {t("tabs.outOf100")}</span>
            </p>
            <div className="fit-track" role="img" aria-label={t("tabs.fitAria", { score: q.score, bar: QUALIFY_BAR })}>
              <i className={q.score >= QUALIFY_BAR ? "is-over" : "is-under"} style={{ width: `${Math.max(2, Math.min(100, q.score))}%` }} />
              <b className="fit-bar" style={{ left: `${QUALIFY_BAR}%` }} aria-hidden />
            </div>
            <p className="route-quiet">{t("back.bar", { bar: QUALIFY_BAR })}</p>
            <ul className="factors">
              {factors.map((f) => (
                <li key={f.key}>
                  <Mark kind={f.ok ? "ok" : "fail"} tip={f.value} />
                  <span>{f.label}</span>
                  <span className="factor-v">{f.value}</span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="route-big absent">{t("back.notScored")}</p>
        )}
      </section>
    </div>
  );
}
