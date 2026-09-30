"use client";

import { useLayoutEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import type { Gig, GigAttempt, GigProposal } from "@/app/_lib/gigs/types";
import type { ReportSection } from "../../../logic/report";
import { GigMeta } from "../../meta/GigMeta";
import { BriefProvenance } from "../../panels/BriefAside";
import type { GigFileState } from "../useGigFile";
import { MovesBlock } from "./MovesBlock";
import type { SummaryKit } from "./useSummaryKit";
import "../../../styles/summary.css";

// The decision sidebar of the Summary prototypes, ONE component on the Summary and Brief tabs:
// the Moves block first (every action, one primary), then the gig's metadata (meta/GigMeta.tsx:
// the listing, kp's id, the track, the figures, the files kp wrote), then where the brief came
// from (BriefAside.tsx: researched by and when, its contents, the sources read). It sticks
// right under the proof's trail while the reading column scrolls - its top is the trail's
// measured height - and scrolls inside itself when taller than the viewport. Under 46rem of
// proof column it is a plain band above the reading column (styles/summary.css).
//   look "card"  - Dossier's calm decision card;
//   look "panel" - Workbench's control panel.

export function DecisionSidebar({
  gig,
  kit,
  proposalFile,
  now,
  attempts,
  onFlash,
  onGo,
  look,
}: {
  gig: Gig;
  kit: SummaryKit;
  proposalFile: GigFileState<GigProposal>;
  now: Date;
  attempts: readonly GigAttempt[];
  onFlash: (message: string) => void;
  onGo: (s: ReportSection) => void;
  look: "card" | "panel";
}) {
  const t = useTranslations("gigs.summaryProto");
  const ref = useRef<HTMLElement | null>(null);
  // Stick right under the trail: its height changes when its tabs wrap to a second row.
  useLayoutEffect(() => {
    const el = ref.current;
    const trail = el?.closest(".gd")?.querySelector<HTMLElement>(".trail");
    if (!el || !trail) return;
    const place = () => el.style.setProperty("--sm-top", `${Math.round(trail.getBoundingClientRect().height) + 12}px`);
    place();
    const ro = new ResizeObserver(place);
    ro.observe(trail);
    return () => ro.disconnect();
  }, []);
  const brief = kit.research.brief;

  return (
    <aside ref={ref} className={`sm-side sm-side--${look}`} aria-label={t(look === "card" ? "sideCard" : "sidePanel")}>
      <MovesBlock gig={gig} kit={kit} proposalFile={proposalFile} onGo={onGo} look={look} />
      <div className="sm-side-meta">
        <p className="sm-side-k">{t("aboutGig")}</p>
        <GigMeta gig={gig} now={now} plans={kit.plansState.plans} attempts={attempts} onFlash={onFlash} />
      </div>
      {brief ? (
        <div className="sm-side-meta">
          <p className="sm-side-k">{t("aboutBrief")}</p>
          <BriefProvenance brief={brief} />
        </div>
      ) : null}
    </aside>
  );
}
