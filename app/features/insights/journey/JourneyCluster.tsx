"use client";

// One role cluster: its shared job-definition band, and its columns.
//
// IT NO LONGER CARRIES A RAIL. Every cluster used to draw its own, so a sideways
// journey read rail / columns / rail / columns and each role paid 16rem of
// chrome. The board now draws ONE rail, pinned at the far left of the track,
// which redraws for whichever cluster is under view (JourneyBoardView +
// useClusterInView). The sticky offsets here still clear it — `left-[16rem]` is
// the rail's width, not this cluster's — and `globalBandHeights` is what keeps
// that single rail true for every cluster it floats over.
//
// AND ITS OWN WIDTH IS ITS COLUMNS'. The head and the shared band are `w-0
// min-w-full`: they fill the cluster at layout time and contribute NOTHING to
// its intrinsic width. Before, the band was a flat `w-[44rem]` and the title
// `whitespace-nowrap`, so a role with ONE candidate measured 964px — 320px of
// column and 644px of empty field beside it. Text is not allowed to set the
// width of a grid; it wraps or it clamps inside whatever the columns need.
//
// THE SHARED BAND IS A CLAIM ABOUT THE DATA. One conversation defined this role;
// it happened once, above every column, and drawing it once is the honest
// picture (`journey.shared.headline`). But a band that SPANS a cohort asserts
// that the conversation belongs to that cohort, and `RoleCluster.sharedEventsUnlinked`
// says when the record does not actually support that — no `job_id`, no matching
// `jd_slug`. So the caveat rides the band itself (`journey.shared.unlinked`)
// rather than sitting in a footnote nobody scrolls to.
//
// It also PINS. The sentences are `position: sticky` at the rail's right edge,
// so they stay readable while the reader travels sideways through 45 columns —
// the winner's "its sentences stick to the left edge while you travel beneath
// it". The band's own left offset is the rail width, not 0, or it would slide
// under the rail.

import { memo, useCallback } from "react";
import { useTranslations } from "next-intl";
import { NOTICE } from "@/app/_components/ui/recipes";
import { useDateFormat } from "@/app/_components/ui/useDateFormat";
import type { JourneyPhaseId } from "@/app/_lib/journey/types";
import { JourneyColumn } from "./JourneyColumn";
import type { LitRow } from "./JourneyRail";
import { JourneyRow } from "./JourneyRow";
import {
  JOURNEY_BAND_LABEL_PX,
  JOURNEY_CLUSTER_HEAD_PX,
  JOURNEY_COLUMN_HEAD_PX,
  JOURNEY_RAIL_LEFT,
  JOURNEY_SHARED_HEAD_PX,
  type ClusterPlan,
  rowHeight,
  rowOffset,
} from "./journeyLayout";

export type JourneyClusterProps = {
  plan: ClusterPlan;
  phases: readonly JourneyPhaseId[];
  bandPx: Map<JourneyPhaseId, number>;
  sharedPx: number;
  unit: number;
  silencePx: number;
  lit: LitRow;
  selectedEventId: string | null;
  onSelectRow: (entryId: string | null, eventId: string) => void;
  isMounted: (entryId: string) => boolean;
  observe: (entryId: string) => (node: HTMLElement | null) => void;
};

/** Where the lit row sits inside the cluster body, in px from the body's top. */
export function litRowOffset(
  plan: ClusterPlan,
  phases: readonly JourneyPhaseId[],
  bandPx: Map<JourneyPhaseId, number>,
  sharedPx: number,
  lit: NonNullable<LitRow>,
  unit: number,
  silencePx: number,
  sharedBandOnly: boolean
): { top: number; height: number } | null {
  const sharedTop = JOURNEY_CLUSTER_HEAD_PX + JOURNEY_SHARED_HEAD_PX;
  if (sharedBandOnly) {
    if (lit.row >= plan.sharedRowCount) return null;
    return {
      top: sharedTop + rowOffset(lit.row, plan.sharedSilentRows, unit, silencePx),
      height: rowHeight(unit, plan.sharedSilentRows[lit.row] === true, silencePx),
    };
  }
  let top = sharedTop + sharedPx + JOURNEY_COLUMN_HEAD_PX;
  for (const phase of phases) {
    top += JOURNEY_BAND_LABEL_PX;
    if (phase === lit.phase) {
      const phasePlan = plan.phases.get(phase);
      if (!phasePlan || lit.row >= phasePlan.rowCount) return null;
      return {
        top: top + rowOffset(lit.row, phasePlan.silentRows, unit, silencePx),
        height: rowHeight(unit, phasePlan.silentRows[lit.row] === true, silencePx),
      };
    }
    top += bandPx.get(phase) ?? 0;
  }
  return null;
}

function JourneyClusterImpl({
  plan,
  phases,
  bandPx,
  sharedPx,
  unit,
  silencePx,
  lit,
  selectedEventId,
  onSelectRow,
  isMounted,
  observe,
}: JourneyClusterProps) {
  const t = useTranslations("journey");
  const { date } = useDateFormat();
  const cluster = plan.cluster;
  const selectRow = useCallback(
    (entryId: string, eventId: string) => onSelectRow(entryId, eventId),
    [onSelectRow]
  );

  const bodyHeight =
    JOURNEY_CLUSTER_HEAD_PX +
    JOURNEY_SHARED_HEAD_PX +
    sharedPx +
    JOURNEY_COLUMN_HEAD_PX +
    phases.reduce((sum, phase) => sum + JOURNEY_BAND_LABEL_PX + (bandPx.get(phase) ?? 0), 0);

  // The lit row is ONE absolutely-positioned strip across the whole cluster, not
  // a class on every cell: clicking a rail step must not re-render 45 columns.
  const litHere = lit !== null && lit.jobId === cluster.jobId ? lit : null;
  const litInShared =
    litHere !== null && litHere.phase === "job-definition"
      ? litRowOffset(plan, phases, bandPx, sharedPx, litHere, unit, silencePx, true)
      : null;
  const litInBands =
    litHere !== null && phases.includes(litHere.phase)
      ? litRowOffset(plan, phases, bandPx, sharedPx, litHere, unit, silencePx, false)
      : null;
  const litBox = litInBands ?? litInShared;

  return (
    <section
      className="relative flex flex-none border-r-4 border-stone-300"
      aria-label={cluster.title}
      style={{ minHeight: bodyHeight }}
    >
      <div className="relative flex-none">
        <header
          className="sticky top-0 z-20 flex w-0 min-w-full shrink-0 items-center border-b border-stone-200 bg-paper"
          style={{ height: JOURNEY_CLUSTER_HEAD_PX }}
        >
          <div className={`sticky ${JOURNEY_RAIL_LEFT} flex min-w-0 max-w-[28rem] items-baseline gap-3 px-3`}>
            <h2 className="truncate font-serif text-h3 text-ink">{cluster.title}</h2>
            <span className="nums shrink-0 text-xs text-steel">{date(cluster.openedAt)}</span>
          </div>
        </header>

        <div
          className="relative w-0 min-w-full shrink-0 border-b-2 border-ink bg-limewash/30"
          style={{ height: JOURNEY_SHARED_HEAD_PX + sharedPx }}
        >
          <div className={`sticky ${JOURNEY_RAIL_LEFT} flex max-w-[44rem] flex-col`}>
            <div
              className="flex flex-col justify-center gap-1 overflow-hidden border-b border-stone-200 px-3"
              style={{ height: JOURNEY_SHARED_HEAD_PX }}
            >
              <p className="text-sm leading-snug text-ink">
                {t("shared.headline", { count: cluster.totalColumns })}
              </p>
              {cluster.sharedEventsUnlinked ? (
                <p className={`${NOTICE("amber")} inline-block px-2 py-0.5 text-xs`} role="status">
                  {t("shared.unlinked")}
                </p>
              ) : null}
            </div>
            {plan.shared.map((cell) => (
              <JourneyRow
                key={cell.event.id}
                event={cell.event}
                origin={undefined}
                silenceDays={cell.silenceDays}
                height={unit}
                silenceHeight={silencePx}
                selected={selectedEventId === cell.event.id}
                onSelect={(eventId) => onSelectRow(null, eventId)}
              />
            ))}
          </div>
        </div>

        <div className="flex">
          {plan.columns.map((columnPlan) => (
            <JourneyColumn
              key={columnPlan.column.entryId}
              plan={columnPlan}
              cluster={plan}
              phases={phases}
              bandPx={bandPx}
              unit={unit}
              silencePx={silencePx}
              mounted={isMounted(columnPlan.column.entryId)}
              selectedEventId={selectedEventId}
              onSelect={selectRow}
              columnRef={observe(columnPlan.column.entryId)}
            />
          ))}
        </div>

        {litBox ? (
          <div
            className="pointer-events-none absolute inset-x-0 z-10 border-y-2 border-coral bg-coral/10"
            style={{ top: litBox.top, height: litBox.height }}
            aria-hidden="true"
          />
        ) : null}
      </div>
    </section>
  );
}

export const JourneyCluster = memo(JourneyClusterImpl);
