"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import type { Gig } from "@/app/_lib/gigs/types";
import { deadlineView } from "../logic/facts";

// A gig's reward and deadline as the front page sets them - in the lead, the index rows and
// the whole file alike (GigsFront.tsx, FrontLead.tsx, FrontIndex.tsx, FileTable.tsx).

export type RewardCell = (g: Gig, withCurrency: boolean) => ReactNode;
export type DeadlineCell = (g: Gig, words?: boolean) => ReactNode;

export function useGigCells(now: Date): { reward: RewardCell; deadline: DeadlineCell } {
  const t = useTranslations("gigs");
  const reward: RewardCell = (g, withCurrency) =>
    g.reward ? (
      <span>
        {g.reward.text.replace(/\s+(INR|USD|EUR|GBP|CAD|AUD|SGD|NZD|USDC)$/, "")}
        {withCurrency && g.reward.currency ? <span className="dim"> {g.reward.currency}</span> : null}
      </span>
    ) : (
      <span className="absent">{t("front.rewardNone")}</span>
    );
  const deadline: DeadlineCell = (g, words = false) => {
    const d = deadlineView(g.deadlineAt, now);
    if (d.state === "none") return <span className="absent">{t("front.deadlineNone")}</span>;
    if (d.state === "passed") return <span className="dim">{t("front.closed")}</span>;
    const text = words ? t("front.closesIn", { days: Math.max(0, d.days) }) : t("front.daysLeft", { days: Math.max(0, d.days) });
    return <span className={d.state === "soon" ? "coral" : undefined}>{text}</span>;
  };
  return { reward, deadline };
}
