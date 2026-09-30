"use client";

import { useTranslations } from "next-intl";
import { gigTypeOf } from "@/app/_lib/gigs/gig-type";
import type { Gig } from "@/app/_lib/gigs/types";
import { useGigsFormat } from "../../data/useGigsFormat";
import { firstClause, leadOf, listingOpening, reportAnchor, type Spend } from "../../logic/report";
import type { SummaryText } from "../../logic/summary";
import { ListingLanguage } from "../../shared/ListingLanguage";
import { useStage } from "../ProofHead";
import { Callout } from "./parts";
import { ReportStats } from "./ReportStats";

// Section 1, the gig: an eyebrow (arena · gig type · stage), the title set large in the
// serif, the lead - the deliverable's summary once a draft exists, else the brief's "What
// the gig is" - with a highlighter on its first clause and its points under it, the
// listing's language when it is not English (and its English translation one click away),
// the stat cards, and a callout when the work is not wholly digital. A gig nobody
// researched yet leads with the listing's opening, marked as the stranger's words.

export function ReportHero({ gig, summary, now, spend, onOpenListing }: { gig: Gig; summary: SummaryText; now: Date; spend: Spend; onOpenListing: () => void }) {
  const t = useTranslations("gigs");
  const fmt = useGigsFormat();
  const { stage, waits } = useStage(gig);
  const brief = gig.brief;
  const { lead, points } = summary.kind === "listing" ? { lead: "", points: [] } : leadOf(summary.text);
  const [head, rest] = firstClause(lead);
  const kind = brief?.workKind === "mixed" || brief?.workKind === "physical" ? brief.workKind : null;

  return (
    <header className="rp-hero">
      <p className="rp-eyebrow">
        <span>{fmt.arena(gig.arena)}</span>
        <span aria-hidden> · </span>
        <span>{t(`lanes.type.${gigTypeOf(gig)}`)}</span>
        <span aria-hidden> · </span>
        <span className={waits ? "is-waits" : undefined}>{stage}</span>
      </p>
      <h2 id={reportAnchor("gig")} tabIndex={-1} className="rp-title">
        {brief?.title ?? gig.title}
      </h2>
      {brief?.title && brief.title !== gig.title ? <p className="rp-was">{t("report.hero.listedAs", { title: gig.title })}</p> : null}

      {summary.kind === "listing" ? (
        <div className="rp-opening">
          <p className="rp-kicker">{t("report.hero.opening")}</p>
          <p className="rp-opening-text">{listingOpening(summary.text)}</p>
          <button type="button" className="linkbtn" onClick={onOpenListing}>
            {t("report.hero.wholeListing")}
          </button>
        </div>
      ) : (
        <>
          <p className="rp-lead">
            <mark className="rp-hl">{head}</mark>
            {rest}
          </p>
          {points.length ? (
            <ul className="rp-points">
              {points.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
          ) : null}
          <p className="rp-lead-src">{summary.kind === "summary" ? t("report.hero.fromDraft") : t("report.hero.fromBrief")}</p>
        </>
      )}

      <ListingLanguage brief={brief} />
      {kind ? (
        <Callout tone={kind === "physical" ? "coral" : "amber"} label={t(`report.hero.work.${kind}`)}>
          <p>{brief?.workKindReason?.trim() || t("report.hero.work.noReason")}</p>
        </Callout>
      ) : null}
      <ReportStats gig={gig} now={now} spend={spend} />
    </header>
  );
}
