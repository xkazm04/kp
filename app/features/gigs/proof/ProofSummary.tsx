"use client";

import { useTranslations } from "next-intl";
import { Markdown } from "@/app/_components/Markdown";
import { Tag } from "@/app/_components/kit";
import type { Gig } from "@/app/_lib/gigs/types";
import { useGigsFormat } from "../data/useGigsFormat";
import { deadlineView } from "../logic/facts";
import type { SummaryText } from "../logic/summary";
import type { SourceRow } from "../logic/wire";
import { DifficultyGlyph } from "../shared/GigsMarks";

// The Summary tab: what this proof is, set for reading and shown whole - the deliverable's
// summary as Markdown (a lead and bullets; an older one-paragraph summary is set the same
// way, logic/summary summaryMarkdown), or, with no draft yet, the brief's "What the gig is",
// or the listing as untrusted text. The rail beside it carries the key facts as tags and
// values: the category, the listing reference, reward, deadline, difficulty and effort, the
// arena, the listing's own tags.

function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    // Not a URL we can parse: show it as written, it is text either way.
    return url;
  }
}

const TAGS = 8;

export function ProofSummary({ gig, summary, source, now }: { gig: Gig; summary: SummaryText; source: SourceRow | null; now: Date }) {
  const t = useTranslations("gigs");
  const fmt = useGigsFormat();
  const d = deadlineView(gig.deadlineAt, now);
  const label = summary.kind === "summary" ? t("proof.summaryLabel") : summary.kind === "about" ? t("proof.aboutLabel") : t("proof.listingLabel");
  const suspect = gig.status === "suspect" || gig.suspectReasons.length > 0;
  const cats = gig.brief ? gig.brief.category.split(/\s*·\s*/).filter(Boolean) : [];
  const host = source?.host?.replace(/^(www|api)\./, "") ?? hostOf(gig.url);
  return (
    <section className="summary-card" aria-label={label}>
      <div className="sc-main">
        <span className="caps dim">{label}</span>
        {summary.kind === "listing" ? <p className="sc-listing">{summary.text}</p> : <Markdown content={summary.text} className="md-body sc-md" />}
      </div>
      <dl className="sc-rail">
        {cats.length ? (
          <div className="sc-row">
            <dt>{t("proof.category")}</dt>
            <dd className="tag-row">
              {cats.map((c) => (
                <Tag key={c} label={c} />
              ))}
            </dd>
          </div>
        ) : null}
        <div className="sc-row">
          <dt>{t("proof.listingRef")}</dt>
          <dd>
            {suspect ? (
              <span className="anywhere">{host}</span>
            ) : (
              <a className="sc-link" href={gig.url} target="_blank" rel="noopener noreferrer">
                {host} ↗
              </a>
            )}
            {gig.org ? <span className="sc-quiet">{gig.org}</span> : null}
          </dd>
        </div>
        <div className="sc-row">
          <dt>{t("facts.reward")}</dt>
          <dd className="strong">{gig.reward ? gig.reward.text : <span className="absent">{t("facts.rewardNotStated")}</span>}</dd>
        </div>
        <div className="sc-row">
          <dt>{t("facts.deadline")}</dt>
          <dd className={d.state === "soon" || d.state === "passed" ? "coral" : undefined}>
            {d.state === "none" ? <span className="absent">{t("facts.noDeadline")}</span> : d.state === "passed" ? t("facts.deadlinePassed", { date: fmt.date(d.at) }) : t("front.closesIn", { days: Math.max(0, d.days) })}
          </dd>
        </div>
        {gig.brief ? (
          <div className="sc-row">
            <dt>{t("brief.difficulty")}</dt>
            <dd className="with-glyph">
              <DifficultyGlyph difficulty={gig.brief.difficulty} />
              {gig.brief.difficulty === "unrated" ? <span className="absent">{t("brief.level.unrated")}</span> : t(`brief.level.${gig.brief.difficulty}`)}
              {gig.brief.effort ? <span className="sc-quiet">{t("brief.effortRange", { min: gig.brief.effort.minHours, max: gig.brief.effort.maxHours })}</span> : null}
            </dd>
          </div>
        ) : null}
        <div className="sc-row">
          <dt>{t("facts.arena")}</dt>
          <dd>{fmt.arena(gig.arena)}</dd>
        </div>
        {gig.tags.length ? (
          <div className="sc-row">
            <dt>{t("proof.tags")}</dt>
            <dd className="tag-row">
              {gig.tags.slice(0, TAGS).map((x) => (
                <Tag key={x} label={x} />
              ))}
              {gig.tags.length > TAGS ? <span className="sc-quiet">{t("proof.moreTags", { count: gig.tags.length - TAGS })}</span> : null}
            </dd>
          </div>
        ) : null}
      </dl>
    </section>
  );
}
