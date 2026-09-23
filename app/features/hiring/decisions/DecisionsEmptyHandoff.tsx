"use client";

/**
 * Decisions empty state — variant B: "relay handoff".
 *
 * Metaphor: **you passed the baton.** The fork is idle because the work moved
 * downstream, not because it stopped. So the surface reads as a departures
 * board: the glyph is the hero (the fork itself, at rest), and each chain
 * destination is a full card telling the recruiter what is waiting for them
 * there — the next leg of the relay, not a footnote link.
 *
 * Differs from the baseline `ChainEmptyState`: the links are promoted from
 * inline text to the primary affordance, and the copy voice is forward-looking
 * ("next leg") rather than terminal ("caught up"). Same chain, same hops.
 */

import { useEffect, useRef } from "react";
import { Activity, ArrowRight, RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import { MotionizedGlyph } from "@/app/_components/glyph/MotionizedGlyph";
import { EMPTY_ARRIVAL_WATCH, ambientFor, resolveArrival, stepArrival } from "@/app/_components/glyph/glyphArrival";
import { useTasks } from "@/app/features/shell/tasks/TasksProvider";
import { GLYPH_SIZE } from "@/app/_components/glyph/glyphSizes";
import { CARD_PAD, EYEBROW, ICON_STICKER, NOTICE, PANEL, PANEL_SUNKEN } from "@/app/_components/ui/recipes";
import { DESTINATION_ICON, hintFor, useChainNav, type ChainLink } from "./DecisionsEmptyShared";
import type { DecisionsEmptyProps } from "./DecisionsEmptyShared";

/** One leg of the relay: where the work is now, and what is waiting there. */
function DestinationCard({ link, onOpen }: { link: ChainLink; onOpen: () => void }) {
  const t = useTranslations("decisions.empty");
  const Icon = DESTINATION_ICON[link.tab];
  const hintKey = hintFor(link.tab);
  const hint = hintKey ? t(hintKey) : null;
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`${PANEL} ${CARD_PAD} focus-ring group flex w-full items-start gap-3 text-left transition-colors hover:border-coral/40`}
    >
      {Icon ? (
        <span className={`${ICON_STICKER} h-10 w-10 shrink-0`}>
          <Icon size={18} aria-hidden className="text-moss" />
        </span>
      ) : null}
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1 text-base font-semibold text-ink">
          {link.label}
          <ArrowRight size={14} aria-hidden className="text-coral transition-transform group-hover:translate-x-0.5" />
        </span>
        {hint ? <span className="mt-1 block text-sm text-steel">{hint}</span> : null}
      </span>
    </button>
  );
}

export function DecisionsEmptyHandoff({
  title,
  body,
  links,
  reconsiderCount,
  onRevealReconsider,
  onArrivalLanded,
}: DecisionsEmptyProps & {
  onRevealReconsider: () => void;
  /** The queue's reload. Called when a screening that would fill this queue lands
   *  a decision or finishes — useLiveRefresh does not fire for background tasks. */
  onArrivalLanded: () => void;
}) {
  const t = useTranslations("decisions.empty");
  const go = useChainNav();
  // "Caught up" vs "on its way": the tasks that deposit into this queue are already
  // polled. A frozen poll (loadFailed) never claims an arrival (glyphArrival.ts).
  const { tasks, loadFailed } = useTasks();
  const arrival = resolveArrival({ tab: "decisions", tasks, loadFailed });
  const watch = useRef(EMPTY_ARRIVAL_WATCH);
  useEffect(() => {
    const step = stepArrival(watch.current, { tab: "decisions", tasks, loadFailed });
    watch.current = step.watch;
    if (step.reload) onArrivalLanded();
  }, [tasks, loadFailed, onArrivalLanded]);
  const inFlight = arrival.mode === "arriving" ? arrival : null;
  return (
    <div className={`${PANEL_SUNKEN} p-8 text-center`}>
      {/* Hero: the decision fork — at rest when idle, breathing while a screen runs. */}
      <MotionizedGlyph
        glyph="decisions"
        ambient={ambientFor(arrival)}
        className={`mx-auto ${GLYPH_SIZE.xl}`}
      />
      <p className={`mt-3 ${EYEBROW}`}>{inFlight ? t("arrivingEyebrow") : t("batonEyebrow")}</p>
      <h3 className="mt-0.5 font-serif text-h2 text-ink">{inFlight ? t("arrivingTitle") : title}</h3>
      <p className="mx-auto mt-2 max-w-lg text-base text-steel" aria-live="polite">
        {inFlight ? t("arrivingBody", { count: inFlight.count }) : body}
      </p>
      {inFlight ? (
        <div className="mt-3 flex flex-wrap items-center justify-center gap-3 text-sm">
          {inFlight.total > 0 ? (
            <span className="font-semibold tabular-nums text-ink">
              {t("arrivingProgress", { done: inFlight.done, total: inFlight.total })}
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => go("tasks")}
            className="focus-ring inline-flex items-center gap-1 font-semibold text-coral hover:underline"
          >
            <Activity size={13} aria-hidden />
            {t("arrivingWatch")}
          </button>
        </div>
      ) : null}

      {links.length > 0 ? (
        <div className="mx-auto mt-6 grid max-w-2xl gap-3 sm:grid-cols-2">
          {links.map((link) => (
            <DestinationCard key={link.tab} link={link} onOpen={() => go(link.tab)} />
          ))}
        </div>
      ) : null}

      {/* The one branch that runs backwards: rejects a recruiter can still pull back. */}
      {reconsiderCount > 0 ? (
        <button
          type="button"
          onClick={onRevealReconsider}
          className={`${NOTICE("amber")} focus-ring mx-auto mt-5 inline-flex items-center gap-1.5 px-2.5 py-1 text-sm font-semibold hover:bg-amber-100`}
        >
          <RotateCcw size={13} aria-hidden />
          {t("reconsiderLine", { count: reconsiderCount })}
        </button>
      ) : null}
    </div>
  );
}
