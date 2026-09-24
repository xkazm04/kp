"use client";

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { ArrowLeft, ChevronRight, X } from "lucide-react";
import { BTN_GHOST, BTN_SECONDARY, KBD, NOTICE, PANEL, PANEL_SUNKEN } from "@/app/_components/ui/recipes";
import type { Gig, GigArena, GigAttempt, GigKpi } from "@/app/_lib/gigs/types";
import type { AfterWrite, SourceRow, SpecialistRow } from "./gigsLogic";
import { GigsDesk, type DeskStore } from "./GigsDesk";
import { GigsGigPage } from "./GigsGigPage";
import { useBareKeys } from "./useBareKeys";
import { useGigsFormat } from "./useGigsFormat";

// A gig opened from the line: a FULL PAGE that replaces the wall (not a drawer, not a
// split pane, not a modal). A bar on top carries the way back - "Back to the line", Esc,
// or any crumb of "Gigs / <arena> / <title>" - and the tab restores the wall exactly as
// it was left: its scroll, its search, its filter, the card that was opened.
//
// Below the bar: the review desk for a drafted or approved gig (A/1's desk), otherwise
// the gig's own page with the moves its status allows.

export function GigsDetail({
  gigId,
  gig,
  latest,
  sources,
  specialists,
  kpi,
  now,
  store,
  flash,
  onDismissFlash,
  onBack,
  onChanged,
  onRated,
  onHire,
}: {
  gigId: string;
  /** Null when the gig is not (or no longer) in the list the tab read. */
  gig: Gig | null;
  latest: GigAttempt | null;
  sources: readonly SourceRow[];
  specialists: readonly SpecialistRow[];
  kpi: GigKpi | null;
  now: Date;
  store: DeskStore;
  flash: string | null;
  onDismissFlash: () => void;
  /** Back to the wall; `arena` asks it to bring that arena's row into view. */
  onBack: (arena?: GigArena) => void;
  onChanged: AfterWrite;
  onRated: (message: string) => void;
  onHire: (arena: GigArena) => void;
}) {
  const t = useTranslations("gigs");
  const fmt = useGigsFormat();
  const topRef = useRef<HTMLDivElement | null>(null);
  const backRef = useRef<HTMLButtonElement | null>(null);

  // Arriving on a new page: start at its top, with focus on the way back.
  useEffect(() => {
    topRef.current?.scrollIntoView({ block: "start" });
    backRef.current?.focus({ preventScroll: true });
  }, [gigId]);

  useBareKeys((key) => {
    if (key !== "escape") return false;
    onBack();
    return true;
  });

  const source = gig?.sourceId ? (sources.find((s) => s.id === gig.sourceId) ?? null) : null;
  const specialistId = latest?.specialistId ?? gig?.specialistId ?? null;
  const specialist = specialistId ? (specialists.find((s) => s.id === specialistId) ?? null) : null;
  const onDesk = latest !== null && (latest.status === "drafted" || latest.status === "approved");

  return (
    <div ref={topRef} className="scroll-mt-4 space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <button ref={backRef} type="button" onClick={() => onBack()} className={`${BTN_SECONDARY} h-9 px-3 text-sm`}>
          <ArrowLeft size={14} aria-hidden /> {t("detail.back")} <kbd className={`${KBD} ml-1 text-xs`}>{t("detail.escKey")}</kbd>
        </button>
        <nav aria-label={t("facts.breadcrumb")} className="min-w-0 flex-1">
          <ol className="flex min-w-0 flex-wrap items-center gap-1.5 text-sm text-steel">
            <li>
              <button type="button" onClick={() => onBack()} className="focus-ring font-semibold text-steel hover:text-ink hover:underline">
                {t("detail.crumbRoot")}
              </button>
            </li>
            {gig ? (
              <>
                <li className="inline-flex items-center gap-1.5">
                  <ChevronRight size={14} aria-hidden />
                  <button type="button" onClick={() => onBack(gig.arena)} className="focus-ring hover:text-ink hover:underline">
                    {fmt.arena(gig.arena)}
                  </button>
                </li>
                <li className="inline-flex min-w-0 items-center gap-1.5">
                  <ChevronRight size={14} aria-hidden />
                  <span aria-current="page" className="truncate text-ink">
                    {gig.title}
                  </span>
                </li>
              </>
            ) : null}
          </ol>
        </nav>
      </div>

      {flash ? (
        <div role="status" className={`${NOTICE("info")} flex items-start justify-between gap-3 px-3 py-2 text-sm`}>
          <span>{flash}</span>
          <button type="button" onClick={onDismissFlash} className={`${BTN_GHOST} h-6 px-1`} aria-label={t("detail.dismiss")}>
            <X size={14} aria-hidden />
          </button>
        </div>
      ) : null}

      <div className={`${PANEL} min-w-0`}>
        {!gig ? (
          <div className={`${PANEL_SUNKEN} m-6 px-6 py-8 text-center`}>
            <p className="font-serif text-h3 text-ink">{t("detail.notFoundTitle")}</p>
            <p className="mx-auto mt-1 max-w-lg text-sm text-steel">{t("detail.notFound")}</p>
          </div>
        ) : onDesk ? (
          <GigsDesk key={latest.id} gig={gig} attempt={latest} source={source} specialist={specialist} now={now} store={store} onChanged={onChanged} />
        ) : (
          <GigsGigPage
            key={gig.id}
            gig={gig}
            latest={latest}
            source={source}
            specialist={specialist}
            specialists={specialists}
            kpi={kpi}
            now={now}
            onChanged={onChanged}
            onRated={onRated}
            onHire={onHire}
          />
        )}
      </div>
    </div>
  );
}
