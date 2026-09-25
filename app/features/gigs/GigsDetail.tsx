"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { ArrowLeft, ChevronLeft, ChevronRight, X } from "lucide-react";
import { BTN_GHOST, BTN_SECONDARY, KBD, NOTICE, PANEL, PANEL_SUNKEN } from "@/app/_components/ui/recipes";
import { useErrorMessage, type ApiErrorPayload } from "@/app/_lib/use-error-message";
import type { Gig, GigArena, GigAttempt, GigKpi } from "@/app/_lib/gigs/types";
import { afterDeclineTarget, canQuickDecline, checklistFor, type AfterWrite, type ColumnNeighbours, type SourceRow, type SpecialistRow } from "./gigsLogic";
import { GigsDesk, type DeskStore } from "./GigsDesk";
import { GigsGigPage } from "./GigsGigPage";
import { GigWorkspaceRow } from "./GigsWorkspace";
import { useBareKeys } from "./useBareKeys";
import { sendJson } from "./useGigsData";
import { useGigsFormat } from "./useGigsFormat";

// A gig opened from the line: a FULL PAGE that replaces the wall (not a drawer, not a
// split pane, not a modal). A bar on top carries the way back - "Back to the line", Esc,
// or any crumb of "Gigs / <arena> / <title>" - and the tab restores the wall exactly as
// it was left: its scroll, its search, its filter, the card that was opened.
//
// The same bar carries the quick decisions: "‹ 3 of 7 in Drafted ›" (Left / Right walk
// the gig's own wall column, in the wall's order, no wrap) and "Decline (D)" wherever the
// status still allows a decline. Declining is terminal, so the first D only opens an
// inline confirm ("press D again or Enter, Esc cancels"); a confirmed decline lands on
// the next gig in the column, else the previous, else the wall, with a flash naming it.
// Every page swap - arrows, decline, a crumb - lands with focus on the new page's top
// control and the page at its top (the [gigId] effect below; registry
// focus-transfer-on-in-place-navigation), so focus never sits on a control that is gone.
//
// Below the bar: the gig's workspace row (its folder and Personas project, GigsWorkspace.tsx),
// then the review desk for a drafted or approved gig (A/1's desk), otherwise the gig's own
// page with the moves its status allows.

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
  neighbours,
  onDismissFlash,
  onBack,
  onStep,
  onDeclined,
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
  /** This gig's place in its wall column (gigsLogic columnNeighbours); null off the wall. */
  neighbours: ColumnNeighbours | null;
  onDismissFlash: () => void;
  /** Back to the wall; `arena` asks it to bring that arena's row into view. */
  onBack: (arena?: GigArena) => void;
  /** Swap this page for another gig's. */
  onStep: (gigId: string) => void;
  /** After a decline: open `nextGigId` (or the wall when null) and say `message`. */
  onDeclined: (nextGigId: string | null, message: string) => void;
  onChanged: AfterWrite;
  onRated: (message: string) => void;
  onHire: (arena: GigArena) => void;
}) {
  const t = useTranslations("gigs");
  const fmt = useGigsFormat();
  const resolveError = useErrorMessage();
  const topRef = useRef<HTMLDivElement | null>(null);
  const backRef = useRef<HTMLButtonElement | null>(null);
  const confirmYesRef = useRef<HTMLButtonElement | null>(null);
  const declineRef = useRef<HTMLButtonElement | null>(null);
  /** The gig the decline confirm is open for: keyed by id, so a page swap closes it. */
  const [confirmFor, setConfirmFor] = useState<string | null>(null);
  const [declining, setDeclining] = useState(false);
  const [declineError, setDeclineError] = useState<{ gigId: string; text: string } | null>(null);

  // Arriving on a new page: start at its top, with focus on the way back.
  useEffect(() => {
    topRef.current?.scrollIntoView({ block: "start" });
    backRef.current?.focus({ preventScroll: true });
  }, [gigId]);

  const canDecline = gig !== null && canQuickDecline(gig.status);
  const confirming = canDecline && confirmFor === gigId;

  // The confirm's own button takes focus when it opens, so Enter confirms natively and a
  // screen reader hears the question; Esc hands focus back to "Decline (D)".
  useEffect(() => {
    if (confirming) confirmYesRef.current?.focus();
  }, [confirming]);

  function cancelConfirm() {
    setConfirmFor(null);
    window.requestAnimationFrame(() => declineRef.current?.focus());
  }

  async function decline() {
    if (!gig || declining) return;
    const target = afterDeclineTarget(neighbours);
    const title = gig.title;
    setDeclining(true);
    setDeclineError(null);
    const res = await sendJson(`/api/gigs/${encodeURIComponent(gig.id)}`, "PATCH", { action: "decline" });
    setDeclining(false);
    if (!res.ok) {
      setDeclineError({ gigId: gig.id, text: resolveError(res.body as ApiErrorPayload | null, t("work.actionFailed")) });
      return;
    }
    setConfirmFor(null);
    await onChanged(null);
    onDeclined(target, t("detail.declinedFlash", { title }));
  }

  useBareKeys((key) => {
    if (declining) return key === "d" || key === "enter";
    if (confirming) {
      if (key === "escape") {
        cancelConfirm();
        return true;
      }
      if (key === "d") {
        void decline();
        return true;
      }
      if (key === "enter") {
        // Enter on a focused control is that control's own click (the confirm's button
        // holds focus while it is open); only a stray Enter with focus elsewhere confirms.
        const active = document.activeElement;
        if (active && active !== document.body && active.closest("button, a, input, select, textarea, [role='button']")) return false;
        void decline();
        return true;
      }
    }
    if (key === "escape") {
      onBack();
      return true;
    }
    if (key === "arrowleft" && neighbours?.prev) {
      onStep(neighbours.prev);
      return true;
    }
    if (key === "arrowright" && neighbours?.next) {
      onStep(neighbours.next);
      return true;
    }
    if (key === "d" && canDecline && !confirming) {
      setDeclineError(null);
      setConfirmFor(gigId);
      return true;
    }
    return false;
  });

  const source = gig?.sourceId ? (sources.find((s) => s.id === gig.sourceId) ?? null) : null;
  const specialistId = latest?.specialistId ?? gig?.specialistId ?? null;
  const specialist = specialistId ? (specialists.find((s) => s.id === specialistId) ?? null) : null;
  const onDesk = latest !== null && (latest.status === "drafted" || latest.status === "approved");
  const stepLabel = neighbours ? fmt.status(neighbours.step) : "";
  const kbd = (chunks: ReactNode) => <kbd className={`${KBD} text-xs`}>{chunks}</kbd>;
  const error = declineError && declineError.gigId === gigId ? declineError.text : null;

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
        {gig && neighbours ? (
          <div role="group" aria-label={t("detail.columnLabel", { step: stepLabel })} className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={!neighbours.prev}
              onClick={() => neighbours.prev && onStep(neighbours.prev)}
              aria-label={t("detail.prevInColumn", { step: stepLabel })}
              className={`${BTN_SECONDARY} h-9 px-2 text-sm`}
            >
              <ChevronLeft size={14} aria-hidden /> <kbd className={`${KBD} text-xs`}>←</kbd>
            </button>
            <span className="whitespace-nowrap text-sm text-ink nums">{t("detail.columnPos", { index: neighbours.index, total: neighbours.total, step: stepLabel })}</span>
            <button
              type="button"
              disabled={!neighbours.next}
              onClick={() => neighbours.next && onStep(neighbours.next)}
              aria-label={t("detail.nextInColumn", { step: stepLabel })}
              className={`${BTN_SECONDARY} h-9 px-2 text-sm`}
            >
              <kbd className={`${KBD} text-xs`}>→</kbd> <ChevronRight size={14} aria-hidden />
            </button>
          </div>
        ) : null}
        {canDecline && !confirming ? (
          <button
            ref={declineRef}
            type="button"
            disabled={declining}
            onClick={() => {
              setDeclineError(null);
              setConfirmFor(gigId);
            }}
            className={`${BTN_SECONDARY} h-9 px-3 text-sm text-coral`}
          >
            {t("detail.decline")} <kbd className={`${KBD} text-xs`}>D</kbd>
          </button>
        ) : null}
      </div>

      <p className="text-sm text-steel">
        {neighbours ? <>{t.rich("detail.keysNav", { kbd })} · </> : null}
        {canDecline ? <>{t.rich("detail.keysDecline", { kbd })} · </> : null}
        {onDesk && gig ? <>{t.rich("detail.keysChecklist", { kbd, count: checklistFor(gig.arena).length })} · </> : null}
        {t.rich("detail.keysBack", { kbd })}
      </p>

      {confirming && gig ? (
        <div role="group" aria-labelledby={`decline-q-${gig.id}`} className={`${NOTICE("amber")} flex flex-wrap items-center justify-between gap-3 px-3 py-2 text-sm`}>
          <p id={`decline-q-${gig.id}`}>{t.rich("detail.declineConfirm", { title: gig.title, kbd })}</p>
          <div className="flex gap-2">
            <button ref={confirmYesRef} type="button" disabled={declining} onClick={() => void decline()} className={`${BTN_SECONDARY} h-8 px-3 text-sm text-coral`}>
              {declining ? t("detail.declining") : t("detail.declineYes")}
            </button>
            <button type="button" disabled={declining} onClick={cancelConfirm} className={`${BTN_GHOST} h-8 px-3 text-sm`}>
              {t("detail.declineNo")}
            </button>
          </div>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className={`${NOTICE("critical")} px-3 py-2 text-sm`}>
          {error}
        </p>
      ) : null}

      {flash ? (
        <div role="status" className={`${NOTICE("info")} flex items-start justify-between gap-3 px-3 py-2 text-sm`}>
          <span>{flash}</span>
          <button type="button" onClick={onDismissFlash} className={`${BTN_GHOST} h-6 px-1`} aria-label={t("detail.dismiss")}>
            <X size={14} aria-hidden />
          </button>
        </div>
      ) : null}

      {gig ? <GigWorkspaceRow key={gig.id} gig={gig} onChanged={onChanged} /> : null}

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
