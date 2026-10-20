"use client";

import { useTranslations } from "next-intl";
import { gigTypeOf } from "@/app/_lib/gigs/gig-type";
import type { Gig, GigBrief } from "@/app/_lib/gigs/types";
import { useGigsFormat } from "../../data/useGigsFormat";
import { deadlineView } from "../../logic/facts";
import { leadSentence } from "../../logic/moves";
import { QUALIFY_BAR } from "../../logic/rate";
import { leadOf, listingOpening, reportAnchor } from "../../logic/report";
import type { SummaryText } from "../../logic/summary";
import { ListingLanguage } from "../../shared/ListingLanguage";
import { useStage } from "../ProofHead";
import { Callout } from "../report/parts";

// The Summary's compact header. It carries no button (every action is in the sidebar's Moves
// block): an eyebrow (arena · gig type · stage), the title, ONE line of what the gig is - the
// first sentence of the lead (logic/moves.ts leadSentence), never a wall of display type -
// with the rest of the lead and its points folded under it, where the lead came from, then
// the key facts it has as pairs in a row (an absent one is left to the sidebar, which says
// why it is absent), the listing's language (and its translation), and a callout when the
// work is not wholly digital. A gig nobody researched yet leads with the listing's opening.

export const hostOf = (u: string) => {
  try {
    return new URL(u).host.replace(/^www\./, "");
  } catch {
    return u; // not a parseable URL: name it as recorded
  }
};

function useHeroText(summary: SummaryText) {
  const { lead, points } = summary.kind === "listing" ? { lead: listingOpening(summary.text), points: [] } : leadOf(summary.text);
  return { ...leadSentence(lead), points };
}

function Eyebrow({ gig }: { gig: Gig }) {
  const t = useTranslations("gigs");
  const fmt = useGigsFormat();
  const { stage, waits } = useStage(gig);
  return (
    <p className="rp-eyebrow">
      <span>{fmt.arena(gig.arena)}</span>
      <span aria-hidden> · </span>
      <span>{t(`lanes.type.${gigTypeOf(gig)}`)}</span>
      <span aria-hidden> · </span>
      <span className={waits ? "is-waits" : undefined}>{stage}</span>
    </p>
  );
}

function Aside({ brief }: { brief: GigBrief | null }) {
  const t = useTranslations("gigs.report.hero");
  const kind = brief?.workKind === "mixed" || brief?.workKind === "physical" ? brief.workKind : null;
  return (
    <>
      <ListingLanguage brief={brief} />
      {kind ? (
        <Callout tone={kind === "physical" ? "coral" : "amber"} label={t(`work.${kind}`)}>
          <p>{brief?.workKindReason?.trim() || t("work.noReason")}</p>
        </Callout>
      ) : null}
    </>
  );
}

function Source({ summary, kpDraft }: { summary: SummaryText; kpDraft: boolean }) {
  const t = useTranslations("gigs");
  return <p className="rp-lead-src">{summary.kind === "listing" ? t("report.hero.opening") : summary.kind !== "summary" ? t("report.hero.fromBrief") : kpDraft ? t("proposal.hero.fromProposal") : t("report.hero.fromDraft")}</p>;
}

export function SummaryHead({ gig, brief, summary, kpDraft, now, onOpenListing }: { gig: Gig; brief: GigBrief | null; summary: SummaryText; kpDraft: boolean; now: Date; onOpenListing: () => void }) {
  const t = useTranslations("gigs");
  const fmt = useGigsFormat();
  const { lead, rest, points } = useHeroText(summary);
  const d = deadlineView(gig.deadlineAt, now);
  const q = gig.qualification;
  const facts = [
    { k: t("facts.reward"), v: gig.reward?.text ?? null },
    { k: t("facts.deadline"), v: d.state === "none" ? null : d.state === "passed" ? t("report.stat.closed") : `${fmt.number(Math.max(0, d.days))} ${t("report.stat.daysLeft", { count: Math.max(0, d.days) })}`, hot: d.state === "soon" || d.state === "passed" },
    { k: t("brief.difficulty"), v: brief && brief.difficulty !== "unrated" ? t(`brief.level.${brief.difficulty}`) : null },
    { k: t("brief.effort"), v: brief?.effort ? t("brief.effortRange", { min: brief.effort.minHours, max: brief.effort.maxHours }) : null },
    { k: t("report.stat.fit"), v: q ? fmt.number(q.score) : null, hot: false, ok: q ? q.score >= QUALIFY_BAR : false },
  ];
  const more = (rest ? 1 : 0) + points.length;
  return (
    <header className="sm-head">
      <Eyebrow gig={gig} />
      <h2 id={reportAnchor("gig")} tabIndex={-1} className="sm-title">
        {brief?.title ?? gig.title}
      </h2>
      {brief?.title && brief.title !== gig.title ? <p className="rp-was">{t("report.hero.listedAs", { title: gig.title })}</p> : null}
      <p className="sm-what">{lead || rest}</p>
      {more && lead ? (
        <details className="sm-more">
          <summary>{t("summary.moreSummary", { count: more })}</summary>
          {rest ? <p className="sm-body">{rest}</p> : null}
          {points.length ? (
            <ul className="sm-points">
              {points.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
          ) : null}
        </details>
      ) : null}
      <Source summary={summary} kpDraft={kpDraft} />
      {summary.kind === "listing" ? (
        <button type="button" className="linkbtn" onClick={onOpenListing}>
          {t("report.hero.wholeListing")}
        </button>
      ) : null}
      <dl className="sm-facts" aria-label={t("summary.facts")}>
        {facts
          .filter((f) => f.v !== null)
          .map((f) => (
            <div key={f.k} className={f.hot ? "is-hot" : f.ok ? "is-ok" : undefined}>
              <dt>{f.k}</dt>
              <dd>{f.v}</dd>
            </div>
          ))}
      </dl>
      <Aside brief={brief} />
    </header>
  );
}
