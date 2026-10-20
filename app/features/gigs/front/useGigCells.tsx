"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Tooltip } from "@/app/_components/Tooltip";
import type { Gig } from "@/app/_lib/gigs/types";
import { useGigsFormat } from "../data/useGigsFormat";
import { deadlineView } from "../logic/facts";
import { rewardEstimate } from "../logic/file";

// A gig's reward and deadline as the front page sets them - in the lead, the index rows and
// the whole file alike (GigsFront.tsx, FrontLead.tsx, FrontIndex.tsx, FileTable.tsx). A
// reward in a currency other than the dollar or the euro carries a quiet "≈ $150" beside the
// listing's own figure (never in place of it), converted at the scan day's rate: the date
// is its tip, and is read out with it.

export type RewardCell = (g: Gig, withCurrency: boolean) => ReactNode;
export type DeadlineCell = (g: Gig, words?: boolean) => ReactNode;

export function useGigCells(now: Date): { reward: RewardCell; deadline: DeadlineCell } {
  const t = useTranslations("gigs");
  const fmt = useGigsFormat();
  const estimate = (g: Gig) => {
    const est = rewardEstimate(g.reward);
    if (!est) return null;
    const rate = t("front.rewardRate", { date: fmt.date(est.rateAt) });
    return (
      <Tooltip label={rate} className="est-tip">
        <span className="est">
          {t("front.rewardUsd", { usd: fmt.usdAbout(est.amount) })}
          <span className="sr-only"> {rate}</span>
        </span>
      </Tooltip>
    );
  };
  const reward: RewardCell = (g, withCurrency) =>
    g.reward ? (
      <span>
        {g.reward.text.replace(/\s+(INR|USD|EUR|GBP|CAD|AUD|SGD|NZD|USDC)$/, "")}
        {withCurrency && g.reward.currency ? <span className="dim"> {g.reward.currency}</span> : null}
        {estimate(g)}
      </span>
    ) : (
      <span className="absent">{t("front.rewardNone")}</span>
    );
  const deadline: DeadlineCell = (g, words = false) => {
    // What the source last said outranks the stated deadline: an awarded or removed listing is
    // closed whatever its bid window reads (gigs/freshness.ts). Not checked = the deadline alone.
    const src = g.sourceState;
    if (src && src.state !== "open") {
      const label =
        src.state === "awarded"
          ? t("front.sourceAwarded")
          : src.state === "frozen"
            ? t("front.sourceFrozen")
            : src.state === "gone"
              ? t("front.sourceGone")
              : t("front.sourceClosed");
      return <span className="dim">{label}</span>;
    }
    const d = deadlineView(g.deadlineAt, now);
    if (d.state === "none") return <span className="absent">{t("front.deadlineNone")}</span>;
    if (d.state === "passed") return <span className="dim">{t("front.closed")}</span>;
    const text = words ? t("front.closesIn", { days: Math.max(0, d.days) }) : t("front.daysLeft", { days: Math.max(0, d.days) });
    const bids = src?.bidCount != null ? <span className="dim"> · {t("front.sourceBids", { count: src.bidCount })}</span> : null;
    return (
      <span>
        <span className={d.state === "soon" ? "coral" : undefined}>{text}</span>
        {bids}
      </span>
    );
  };
  return { reward, deadline };
}
