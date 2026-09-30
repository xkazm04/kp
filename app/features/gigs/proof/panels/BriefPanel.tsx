"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/app/_components/kit";
import type { Gig } from "@/app/_lib/gigs/types";
import type { AfterWrite } from "../../logic/wire";
import { BriefProvenance } from "./BriefAside";
import type { ChallengeWithdraw } from "./BriefChallenges";
import { BriefText } from "./BriefText";
import { useResearch } from "./useResearch";

// A gig's research brief as the proof's "Research brief" tab (docs/features/gigs/README.md
// "Research"), read the way the registry's long-form-reading-surface subject asks:
//   - LEFT, the reading column on a white panel: the category, the categorized title as the
//     heading, then the Markdown body (the safe renderer: React elements, safe hrefs, links
//     in a new tab) at a reading measure and a reading size;
//   - RIGHT, the aside - the gig's ONE metadata sidebar, the same on the Summary and Brief
//     tabs: `meta` first (meta/GigMeta.tsx: the listing's URL, the gig's id, the figures, the
//     report file), then where the brief came from and Research again, the contents list when
//     there are 3+ sections, and "Sources read" as rows whose status is a mark AND a word.
//     A gig nobody researched yet keeps the sidebar; its reading column says so.
// The column is BriefText.tsx and the provenance blocks BriefAside.tsx (the Summary
// prototypes set both too). Heading ids are the ones the SERVER minted with one assigner (`brief.sections`); nothing is
// re-slugged here. A contents link scrolls its heading in and moves focus onto it. No reading
// time is shown: it would be a claim about the reader the method cannot make.

export function GigBriefPanel({ gig, onChanged, withdraw, meta }: { gig: Gig; onChanged: AfterWrite; withdraw: ChallengeWithdraw; meta: ReactNode }) {
  const t = useTranslations("gigs");
  const { brief, busy, error, research } = useResearch(gig, onChanged);

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
      <section className="panel brief-panel" aria-label={t("brief.title")}>
        <div className="brief-layout">
          <article className="brief-main">
            <h3 className="brief-title">{t("brief.title")}</h3>
            <p className="panel-empty">
              <b>{t("brief.notYet")}.</b> {t("brief.notYetBody")}
            </p>
          </article>
          <aside className="brief-aside" aria-label={t("tabs.briefAside")}>
            {meta}
            <div className="aside-block">
              {button}
              {status}
            </div>
          </aside>
        </div>
      </section>
    );
  }

  return (
    <section className="panel brief-panel" aria-label={t("brief.title")}>
      <div className="brief-layout">
        <article className="brief-main">
          <BriefText brief={brief} withdraw={withdraw} />
        </article>

        <aside className="brief-aside" aria-label={t("tabs.briefAside")}>
          {meta}
          <BriefProvenance
            brief={brief}
            action={
              <>
                {button}
                {status}
              </>
            }
          />
        </aside>
      </div>
    </section>
  );
}
