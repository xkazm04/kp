"use client";

import { useTranslations } from "next-intl";
import type { GigBrief } from "@/app/_lib/gigs/types";
import { useGigsFormat } from "../../data/useGigsFormat";
import { BriefChallenges, type ChallengeWithdraw } from "../panels/BriefChallenges";
import { Figure } from "./parts";

// Section 2, what it asks: the brief's asks beside its expected challenges, one figure in
// two columns. The challenges keep their "Withdraw for this" (BriefChallenges.tsx, the
// Brief tab's rows): a reason to take the gig off the line stays one click away wherever
// it is read.

export function ReportAsks({ brief, asks, challenges, withdraw, figure }: { brief: GigBrief; asks: readonly string[]; challenges: readonly string[]; withdraw: ChallengeWithdraw; figure: number }) {
  const t = useTranslations("gigs.report.asks");
  const fmt = useGigsFormat();
  return (
    <Figure n={figure} what={t("caption", { asks: asks.length, challenges: challenges.length })} source={t("source", { date: fmt.date(brief.createdAt) })}>
      <div className="rp-two">
        <section className="rp-asks" aria-label={t("title")}>
          <h4 className="rp-sub">
            {t("title")} <span className="sub-n">{asks.length || null}</span>
          </h4>
          {asks.length ? (
            <ol className="rp-numlist">
              {asks.map((a, i) => (
                <li key={i}>
                  <span className="bc-n" aria-hidden>
                    {i + 1}
                  </span>
                  <span>{a}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="t-meta">{t("none")}</p>
          )}
        </section>
        {challenges.length ? (
          <BriefChallenges id={undefined} heading={t("challenges")} challenges={challenges} withdraw={withdraw} as="h4" />
        ) : (
          <section className="brief-challenges">
            <h4 className="rp-sub">{t("challenges")}</h4>
            <p className="t-meta">{t("noChallenges")}</p>
          </section>
        )}
      </div>
    </Figure>
  );
}
