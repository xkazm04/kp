"use client";

import { useTranslations } from "next-intl";
import type { Gig } from "@/app/_lib/gigs/types";
import { useGigsFormat } from "../../data/useGigsFormat";
import { deadlineView } from "../../logic/facts";
import { rewardEstimate } from "../../logic/file";
import { QUALIFY_BAR } from "../../logic/rate";
import type { Spend } from "../../logic/report";
import { StatCard } from "./parts";

// The hero's stat cards: what the gig pays (a dollar estimate at the scan day's rate beside
// a reward in another currency than the dollar or the euro), how long is left, how hard it
// looks, how it scored against the bar, and what it has cost so far. Each absent figure is
// "—" with its reason as the caption, never 0: a reward the listing did not state is not a
// reward of zero, and a cost nobody reported is not free.

export function ReportStats({ gig, now, spend }: { gig: Gig; now: Date; spend: Spend }) {
  const t = useTranslations("gigs");
  const fmt = useGigsFormat();
  const d = deadlineView(gig.deadlineAt, now);
  const brief = gig.brief;
  const q = gig.qualification;
  const est = rewardEstimate(gig.reward);
  const effort = brief?.effort ? t("brief.effortRange", { min: brief.effort.minHours, max: brief.effort.maxHours }) : null;
  const parts = [spend.plans !== null ? t("report.stat.plansPart", { usd: fmt.usd(spend.plans) }) : null, spend.drafts !== null ? t("report.stat.draftsPart", { usd: fmt.usd(spend.drafts) }) : null];
  const unreported = spend.unreported ? t("report.stat.unreported", { count: spend.unreported }) : null;

  return (
    <div className="rp-stats">
      <StatCard value={gig.reward?.text ?? null} label={t("facts.reward")} caption={est ? t("report.stat.rewardEstimate", { usd: fmt.usdAbout(est.amount), date: fmt.date(est.rateAt) }) : gig.reward ? t("report.stat.rewardAsStated") : t("facts.rewardNotStated")} />
      <StatCard
        value={d.state === "none" ? null : d.state === "passed" ? t("report.stat.closed") : fmt.number(Math.max(0, d.days))}
        label={d.state === "open" || d.state === "soon" ? t("report.stat.daysLeft", { count: Math.max(0, d.days) }) : t("facts.deadline")}
        caption={d.state === "none" ? t("facts.noDeadline") : t("report.stat.closesOn", { date: fmt.date(d.at) })}
        tone={d.state === "soon" || d.state === "passed" ? "coral" : undefined}
      />
      <StatCard
        value={brief && brief.difficulty !== "unrated" ? t(`brief.level.${brief.difficulty}`) : null}
        label={t("brief.difficulty")}
        caption={!brief ? t("report.stat.ratedAtResearch") : brief.difficulty === "unrated" ? t("brief.unratedWhy") : (effort ?? t("brief.effortNone"))}
      />
      <StatCard value={q ? fmt.number(q.score) : null} label={t("report.stat.fit")} caption={q ? t("back.bar", { bar: QUALIFY_BAR }) : t("back.notScored")} tone={q && q.score >= QUALIFY_BAR ? "moss" : undefined}>
        {q ? (
          <span className="fit-track" role="img" aria-label={t("tabs.fitAria", { score: q.score, bar: QUALIFY_BAR })}>
            <i className={q.score >= QUALIFY_BAR ? "is-over" : "is-under"} style={{ width: `${Math.max(0, Math.min(100, q.score))}%` }} />
            <span className="fit-bar" style={{ left: `${QUALIFY_BAR}%` }} />
          </span>
        ) : null}
      </StatCard>
      <StatCard
        value={spend.total !== null ? fmt.usd(spend.total) : null}
        label={t("report.stat.spend")}
        caption={spend.total === null ? (spend.ran ? t("signoff.costUnreported") : t("report.stat.nothingRan")) : [...parts, unreported].filter(Boolean).join(" · ")}
      />
    </div>
  );
}
