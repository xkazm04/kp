"use client";

import { useTranslations } from "next-intl";
import { Button, KeyValueGrid, KitIcon } from "@/app/_components/kit";
import type { Gig, GigAttempt, GigPlanRow } from "@/app/_lib/gigs/types";
import { useGigsFormat } from "../../data/useGigsFormat";
import { deadlineView } from "../../logic/facts";
import { rewardEstimate } from "../../logic/file";
import { QUALIFY_BAR } from "../../logic/rate";
import { spendSoFar } from "../../logic/report";
import { DifficultyGlyph } from "../../shared/GigsMarks";
import { ProposalFileBlock, ReportFileBlock, TrackBlock } from "./MetaBlocks";

// The gig's metadata in the Summary's decision sidebar (summary/DecisionSidebar.tsx, on the
// Summary tab and the Brief tab alike), in first-screen order: where the gig lives (the
// listing's URL, always, and kp's own id to copy into an internal note), its figures (reward
// with a dollar estimate, deadline, difficulty, effort, fit, spend), then its track (a freelance
// bid or the work as the entry) and the files kp wrote on disk - the client proposal and the
// report (MetaBlocks.tsx). An absent figure is "—" with its reason,
// never 0: a reward the listing did not state is not a reward of zero.

const isWebUrl = (u: string) => /^https?:\/\//i.test(u);
const hostOf = (u: string) => {
  try {
    return new URL(u).host.replace(/^www\./, "");
  } catch {
    return u; // not a parseable URL: show it as recorded
  }
};

export function GigMeta({
  gig,
  now,
  plans,
  attempts,
  onFlash,
}: {
  gig: Gig;
  now: Date;
  plans: readonly GigPlanRow[] | null;
  attempts: readonly GigAttempt[];
  onFlash: (message: string) => void;
}) {
  const t = useTranslations("gigs");
  const fmt = useGigsFormat();
  const brief = gig.brief;
  const q = gig.qualification;
  const d = deadlineView(gig.deadlineAt, now);
  const est = rewardEstimate(gig.reward);
  const spend = spendSoFar(plans, attempts);
  const copy = (text: string, done: string, failed: string) => {
    if (navigator.clipboard) void navigator.clipboard.writeText(text).then(() => onFlash(done), () => onFlash(failed));
    else onFlash(failed);
  };
  const sub = (text: string | null) => (text ? <span className="meta-sub">{text}</span> : null);
  const spendParts = [
    spend.plans !== null ? t("report.stat.plansPart", { usd: fmt.usd(spend.plans) }) : null,
    spend.drafts !== null ? t("report.stat.draftsPart", { usd: fmt.usd(spend.drafts) }) : null,
    spend.unreported ? t("report.stat.unreported", { count: spend.unreported }) : null,
  ].filter(Boolean);

  return (
    <>
      <div className="aside-block meta-where">
        {isWebUrl(gig.url) ? (
          <a className="meta-link" href={gig.url} target="_blank" rel="noopener noreferrer">
            <KitIcon name="open" />
            <span>{t("meta.openListing", { host: hostOf(gig.url) })}</span>
          </a>
        ) : (
          <p className="t-meta">{gig.url ? t("meta.urlAsRecorded", { url: gig.url }) : t("meta.noUrl")}</p>
        )}
        <div className="meta-id">
          <span className="caps dim">{t("meta.id")}</span>
          <code>{gig.id}</code>
          <Button label={t("meta.copyId")} icon="copy" size="sm" variant="ghost" onClick={() => copy(gig.id, t("meta.idCopied"), t("meta.copyFailed"))} />
        </div>
      </div>
      <KeyValueGrid
        cols={2}
        items={[
          {
            label: t("facts.reward"),
            value: gig.reward ? (
              <>
                {gig.reward.text}
                {sub(est ? t("report.stat.rewardEstimate", { usd: fmt.usdAbout(est.amount), date: fmt.date(est.rateAt) }) : null)}
              </>
            ) : null,
            absent: t("facts.rewardNotStated"),
          },
          {
            label: t("facts.deadline"),
            value:
              d.state === "none" ? null : (
                <span className={d.state === "soon" || d.state === "passed" ? "is-coral" : undefined}>
                  {d.state === "passed" ? t("report.stat.closed") : `${fmt.number(Math.max(0, d.days))} ${t("report.stat.daysLeft", { count: Math.max(0, d.days) })}`}
                  {sub(t("report.stat.closesOn", { date: fmt.date(d.at) }))}
                </span>
              ),
            absent: t("facts.noDeadline"),
          },
          {
            label: t("brief.difficulty"),
            value:
              brief && brief.difficulty !== "unrated" ? (
                <span className="with-glyph">
                  <DifficultyGlyph difficulty={brief.difficulty} /> {t(`brief.level.${brief.difficulty}`)}
                </span>
              ) : null,
            absent: brief ? t("brief.unratedWhy") : t("report.stat.ratedAtResearch"),
          },
          { label: t("brief.effort"), value: brief?.effort ? t("brief.effortRange", { min: brief.effort.minHours, max: brief.effort.maxHours }) : null, absent: brief ? t("brief.effortNone") : t("report.stat.ratedAtResearch") },
          {
            label: t("report.stat.fit"),
            value: q ? (
              <span className={q.score >= QUALIFY_BAR ? "is-moss" : undefined}>
                {fmt.number(q.score)}
                {sub(t("back.bar", { bar: QUALIFY_BAR }))}
              </span>
            ) : null,
            absent: t("back.notScored"),
          },
          {
            label: t("report.stat.spend"),
            value: spend.total !== null ? (
              <>
                {fmt.usd(spend.total)}
                {sub(spendParts.join(" · ") || null)}
              </>
            ) : null,
            absent: spend.ran ? t("signoff.costUnreported") : t("report.stat.nothingRan"),
          },
        ]}
      />

      <TrackBlock gig={gig} />
      <ProposalFileBlock gig={gig} copy={copy} />
      <ReportFileBlock gig={gig} copy={copy} />
    </>
  );
}
