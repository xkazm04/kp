"use client";

import { useMemo, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import type { Gig, GigAttempt } from "@/app/_lib/gigs/types";
import { planView } from "../../logic/plans";
import { reportAnchor, summaryBlocks } from "../../logic/report";
import type { SummaryText } from "../../logic/summary";
import type { AfterWrite } from "../../logic/wire";
import type { PlansState } from "../panels/usePlans";
import { ReportSection } from "./parts";
import { ReportChoose } from "./ReportChoose";
import { ReportHero } from "./ReportHero";

// The proof's Summary tab: a quick overview, the long read one click away. The operator's
// call (2026-09-30): the full report is an HTML file the model writes and rewrites as the
// gig moves, opened in the browser; the app keeps
//   - the HERO: eyebrow, title, lead, the full report's row (open it, Regenerate), the
//     listing's language;
//   - the BRIEF: the Brief tab's own panel (panels/BriefPanel.tsx) with its ONE metadata
//     sidebar (meta/GigMeta.tsx: the listing's URL, the gig's id, the figures, the report
//     file), so the gig's metadata reads the same in both places;
//   - then compact working blocks only while they apply: "Choose a plan" (seat cards with
//     Accept; one line once accepted) and "Review the draft" (the proof slip over the galley).
// Progress stays on the Pairing tab and the record on History; evidence lives in the file.

export function GigReport({
  gig,
  attempt,
  summary,
  plansState,
  brief,
  draft,
  onChanged,
  onFlash,
  onOpenTab,
}: {
  gig: Gig;
  attempt: GigAttempt | null;
  summary: SummaryText;
  plansState: PlansState;
  brief: ReactNode;
  draft: ReactNode;
  onChanged: AfterWrite;
  onFlash: (message: string) => void;
  onOpenTab: (tab: "listing") => void;
}) {
  const t = useTranslations("gigs.report");
  const view = useMemo(() => planView(plansState.plans), [plansState.plans]);
  const blocks = summaryBlocks({
    brief: gig.brief !== null,
    plans: plansState.plans === null ? null : (view.shown?.rows.length ?? 0),
    accepted: view.accepted !== null,
    draft: !!attempt?.deliverable?.draftText?.trim(),
  });

  return (
    <article className="rp" aria-label={t("label")}>
      <ReportHero gig={gig} summary={summary} onOpenListing={() => onOpenTab("listing")} onChanged={onChanged} />

      {/* The brief panel names itself (its categories and title, or "Research brief" with
          Research while there is none): no second heading over it. */}
      <div className="rp-brief" id={reportAnchor("brief")}>
        {brief}
      </div>

      {blocks.plans ? (
        <ReportSection id="plans" title={blocks.plans === "accepted" ? t("sec.accepted") : t("sec.plans")}>
          <ReportChoose gig={gig} plansState={plansState} onFlash={onFlash} />
        </ReportSection>
      ) : null}

      {blocks.draft ? (
        <ReportSection id="draft" title={t("sec.draft")}>
          {draft}
        </ReportSection>
      ) : null}
    </article>
  );
}
