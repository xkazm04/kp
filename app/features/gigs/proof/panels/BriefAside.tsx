"use client";

import { useTranslations } from "next-intl";
import type { GigBrief } from "@/app/_lib/gigs/types";
import { useGigsFormat } from "../../data/useGigsFormat";
import { SOURCES_SECTION_ID } from "../../logic/briefBody";
import { jumpTo, LinkRow } from "./BriefLinks";

// The brief's provenance as sidebar blocks: where it came from (a model or kp, how many linked
// pages) and when (Research again is in the Summary's Moves block), the contents list at 3+
// sections, and "Sources read" as rows whose status is a mark AND a word. The heading of
// "Sources read" carries the section's id when the brief's own Markdown had one, so a contents
// link lands.

export function BriefProvenance({ brief }: { brief: GigBrief }) {
  const t = useTranslations("gigs");
  const fmt = useGigsFormat();
  const fetched = brief.links.filter((l) => l.status === "fetched").length;
  const reasonKey = brief.fallbackReason?.startsWith("llm_error") ? "llm_error" : brief.fallbackReason;
  const reason = reasonKey && t.has(`brief.fallback.${reasonKey}` as Parameters<typeof t>[0]) ? t(`brief.fallback.${reasonKey}` as Parameters<typeof t>[0]) : (brief.fallbackReason ?? "").replace(/_/g, " ");
  const sources = brief.sections.find((s) => s.id === SOURCES_SECTION_ID) ?? null;
  const listId = sources && (brief.markdown.includes(`\n## ${sources.text}\n`) || brief.markdown.startsWith(`## ${sources.text}\n`)) ? SOURCES_SECTION_ID : undefined;
  const contents = brief.sections.filter((s) => s.id !== SOURCES_SECTION_ID);

  return (
    <>
      <div className="aside-block">
        <p className="t-meta">
          {brief.source === "llm" ? t("brief.byModel", { count: fetched }) : t("brief.byKp", { count: fetched, reason })}
          <br />
          {t("brief.researchedAt", { date: fmt.dateTime(brief.createdAt) })}
        </p>
      </div>
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
          {sources?.text ?? t("brief.sourcesRead")}
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
    </>
  );
}
