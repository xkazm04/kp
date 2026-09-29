"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Markdown } from "@/app/_components/Markdown";
import { Button, KeyValueGrid, Tag } from "@/app/_components/kit";
import { useErrorMessage, type ApiErrorPayload } from "@/app/_lib/use-error-message";
import type { Gig, GigBrief } from "@/app/_lib/gigs/types";
import { briefChallenges, GIG_BRIEF_CHALLENGES_HEADING } from "@/app/_lib/gigs/withdraw-reasons";
import { briefHeadingResolver } from "../../logic/brief";
import type { AfterWrite } from "../../logic/wire";
import { DifficultyGlyph } from "../../shared/GigsMarks";
import { sendJson } from "../../data/useGigsData";
import { useGigsFormat } from "../../data/useGigsFormat";
import { BriefChallenges, type ChallengeWithdraw } from "./BriefChallenges";
import { jumpTo, LinkRow } from "./BriefLinks";

// A gig's research brief as the proof's "Research brief" tab (docs/features/gigs/README.md
// "Research"), read the way the registry's long-form-reading-surface subject asks:
//   - LEFT, the reading column on a white panel: the category, the categorized title as the
//     heading, then the Markdown body (the safe renderer: React elements, safe hrefs, links
//     in a new tab) at a reading measure and a reading size;
//   - RIGHT, the aside: where the brief came from and Research again, difficulty and effort
//     as figures (their reasons are in the body - nothing is said twice), the contents list
//     when there are 3+ sections, and "Sources read" as rows whose status is a mark AND a word.
// Heading ids are the ones the SERVER minted with one assigner (`brief.sections`); nothing is
// re-slugged here. A contents link scrolls its heading in and moves focus onto it. No reading
// time is shown: it would be a claim about the reader the method cannot make.

/** The fixed section kp's brief closes with; the structured list replaces its prose. */
const SOURCES_SECTION_ID = "sources-read";

export function GigBriefPanel({ gig, onChanged, withdraw }: { gig: Gig; onChanged: AfterWrite; withdraw: ChallengeWithdraw }) {
  const t = useTranslations("gigs");
  const fmt = useGigsFormat();
  const resolveError = useErrorMessage();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The answer of "Research again", shown in place until the list re-read carries it.
  const [fresh, setFresh] = useState<{ gigId: string; brief: GigBrief } | null>(null);
  const brief = fresh && fresh.gigId === gig.id && (!gig.brief || gig.brief.createdAt < fresh.brief.createdAt) ? fresh.brief : gig.brief;

  async function research() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await sendJson(`/api/gigs/${encodeURIComponent(gig.id)}/research`, "POST", {});
    setBusy(false);
    if (!res.ok) {
      setError(resolveError(res.body as ApiErrorPayload | null, t("brief.failed")));
      return;
    }
    const next = (res.body?.gig as Gig | undefined)?.brief ?? null;
    if (next) setFresh({ gigId: gig.id, brief: next });
    await onChanged(null);
  }

  const button = (
    <Button label={brief ? t("brief.researchAgain") : t("brief.research")} loading={busy} loadingLabel={t("brief.researching")} size="sm" variant="secondary" onClick={() => void research()} />
  );
  const status = error ? (
    <p role="alert" className="alert">
      {error}
    </p>
  ) : null;

  if (!brief) {
    return (
      <section className="panel" aria-label={t("brief.title")}>
        <header className="panel-head">
          <div className="panel-title-wrap">
            <h3 className="panel-title">{t("brief.title")}</h3>
          </div>
          <div className="panel-acts">{button}</div>
        </header>
        <p className="panel-empty">
          <b>{t("brief.notYet")}.</b> {t("brief.notYetBody")}
        </p>
        {status}
      </section>
    );
  }

  const fetched = brief.links.filter((l) => l.status === "fetched").length;
  const reasonKey = brief.fallbackReason?.startsWith("llm_error") ? "llm_error" : brief.fallbackReason;
  const reason = reasonKey && t.has(`brief.fallback.${reasonKey}` as Parameters<typeof t>[0]) ? t(`brief.fallback.${reasonKey}` as Parameters<typeof t>[0]) : (brief.fallbackReason ?? "").replace(/_/g, " ");
  const sourcesSection = brief.sections.find((s) => s.id === SOURCES_SECTION_ID) ?? null;
  // The body up to the server-declared "Sources read" heading; the structured list in the
  // aside takes its place. Located by the section the server declared, never re-parsed.
  const cut = sourcesSection ? brief.markdown.indexOf(`\n## ${sourcesSection.text}\n`) : -1;
  const cutAtStart = sourcesSection && brief.markdown.startsWith(`## ${sourcesSection.text}\n`);
  const full = cut >= 0 ? brief.markdown.slice(0, cut) : cutAtStart ? "" : brief.markdown;
  // The "Expected challenges" section is taken out of the Markdown the same way and set as
  // rows with a Withdraw each (BriefChallenges); what follows it, if anything, stays prose.
  const challengesSection = brief.sections.find((s) => s.text === GIG_BRIEF_CHALLENGES_HEADING) ?? null;
  const challenges = briefChallenges(brief);
  const marker = challengesSection && challenges.length ? `## ${challengesSection.text}\n` : null;
  const inner = marker ? full.indexOf(`\n${marker}`) : -1;
  const at = marker ? (full.startsWith(marker) ? 0 : inner >= 0 ? inner + 1 : -1) : -1;
  const next = at >= 0 ? full.indexOf("\n## ", at) : -1;
  const body = at >= 0 ? full.slice(0, at) : full;
  const after = at >= 0 && next >= 0 ? full.slice(next + 1) : "";
  const listId = cut >= 0 || cutAtStart ? SOURCES_SECTION_ID : undefined;
  const headingId = briefHeadingResolver(brief.sections);
  const contents = brief.sections.filter((s) => s.id !== SOURCES_SECTION_ID);

  return (
    <section className="panel brief-panel" aria-label={t("brief.title")}>
      <div className="brief-layout">
        <article className="brief-main">
          <div className="brief-cats">
            {brief.category
              .split(/\s*·\s*/)
              .filter(Boolean)
              .map((c) => (
                <Tag key={c} label={c} />
              ))}
          </div>
          <h3 className="brief-title">{brief.title}</h3>
          {body.trim() ? <Markdown content={body} headingId={headingId} className="md-body brief-body" /> : null}
          {at >= 0 && challengesSection ? <BriefChallenges id={challengesSection.id} heading={challengesSection.text} challenges={challenges} withdraw={withdraw} /> : null}
          {after.trim() ? <Markdown content={after} headingId={headingId} className="md-body brief-body" /> : null}
        </article>

        <aside className="brief-aside" aria-label={t("tabs.briefAside")}>
          <div className="aside-block">
            <p className="t-meta">
              {brief.source === "llm" ? t("brief.byModel", { count: fetched }) : t("brief.byKp", { count: fetched, reason })}
              <br />
              {t("brief.researchedAt", { date: fmt.dateTime(brief.createdAt) })}
            </p>
            {button}
            {status}
          </div>
          <KeyValueGrid
            cols={2}
            items={[
              {
                label: t("brief.difficulty"),
                value:
                  brief.difficulty === "unrated" ? null : (
                    <span className="with-glyph">
                      <DifficultyGlyph difficulty={brief.difficulty} /> {t(`brief.level.${brief.difficulty}`)}
                    </span>
                  ),
                absent: t("brief.unratedWhy"),
              },
              { label: t("brief.effort"), value: brief.effort ? t("brief.effortRange", { min: brief.effort.minHours, max: brief.effort.maxHours }) : null, absent: t("brief.effortNone") },
            ]}
          />
          {contents.length >= 3 ? (
            <nav aria-label={t("brief.contents")} className="aside-block">
              <p className="caps dim">{t("brief.contentsTitle")}</p>
              <ol className="brief-toc">
                {contents.map((s) => (
                  <li key={s.id} className={s.level === 3 ? "is-sub" : undefined}>
                    <a href={`#${s.id}`} onClick={(e) => jumpTo(e, s.id)}>
                      {s.text}
                    </a>
                  </li>
                ))}
              </ol>
            </nav>
          ) : null}
          <div className="aside-block">
            <h4 id={listId} tabIndex={listId ? -1 : undefined} className="caps dim scroll-mt-6">
              {sourcesSection?.text ?? t("brief.sourcesRead")}
            </h4>
            {brief.links.length === 0 ? (
              <p className="t-meta">{t("brief.linksNone")}</p>
            ) : (
              <ul className="brief-links">
                {brief.links.map((l, i) => (
                  <LinkRow key={`${l.url}-${i}`} link={l} />
                ))}
              </ul>
            )}
          </div>
        </aside>
      </div>
    </section>
  );
}
