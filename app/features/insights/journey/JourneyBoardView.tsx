"use client";

// Journey Analytics — the board.
//
// WHAT THIS IS. One column per candidate journey, time running downward, grouped
// into role clusters. ONE canonical-step rail is pinned at the far left of the
// track and redraws for whichever cluster is under the reader's view, so row `n`
// means the same step in every column of THAT cluster and the rail says which
// role it is describing; each cluster carries a shared job-definition band drawn
// ONCE above all of its columns. Three phases in order: job-definition -> case
// -> screening. It is a projection over five append-only logs; there is no
// journey ledger.
//
// WHERE THE DESIGN CAME FROM. A blind design contest ran on this exact problem
// (.contest/arena/journey-analytics/). The owner's verdict picked the winner
// "The Broadsheet" (claude-fable_high/variant-1) and asked for two things from
// the runner-up "The Ladder" (claude-opus_xhigh/variant-2) to be folded in:
//
//   FROM THE WINNER   never-truncated sentence columns; provenance carried in
//                     the MARK rather than in a legend lookup; silence printed
//                     as its own row; three visually distinct empty states; one
//                     global band height; the shared band pinned during sideways
//                     travel; a minimap with a draggable viewport; lazy column
//                     mounting instead of a virtualization library.
//   FROM THE RUNNER-UP a left rail of canonical steps that unifies the columns,
//                     with per-step cohort coverage; and TYPED empty cells —
//                     `skipped` (the journey went on) versus `never-reached`
//                     (it ended here), which must never render alike.
//
// HOW THE TWO WERE RECONCILED, because they disagree. The Broadsheet lets each
// column run on its own free chronology; the Ladder pins every column to a
// shared grid. A rail is only meaningful on a grid — "click a rung and the row
// lights across every column" is false the moment two columns disagree about
// what row 4 is — so the GRID wins, and the Broadsheet's free-flowing ideas are
// re-expressed inside it: a silence stretch becomes a strip at the head of the
// row it precedes (whose extra height every column in the cluster reserves, or
// the grid would break), and an event with no free rung becomes an overflow row
// under the last one rather than being dropped.
//
// EVERY COLOUR RESOLVES THROUGH A TOKEN. The prototypes were deliberately built
// with no kp styling; this is the re-expression. No raw hex, no inline rgba —
// hatches spell their stripe as `var(--color-*)`, and both Studio Light and
// Spark Dark come out of the same class strings.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { BTN_SECONDARY, NOTICE, PANEL } from "@/app/_components/ui/recipes";
import { LoadingGap } from "@/app/_components/ui/LoadingGap";
import type { JourneyEvent, JourneyOrigin, JourneyPhaseId } from "@/app/_lib/journey/types";
import { JourneyCluster } from "./JourneyCluster";
import { JourneyFactCard } from "./JourneyFactCard";
import { JourneyMinimap } from "./JourneyMinimap";
import { JourneyRail, type LitRow } from "./JourneyRail";
import { JourneyToolbar } from "./JourneyToolbar";
import { EMPTY_JOURNEY_FILTERS, filterBoard, withSelectedRole, type JourneyFilterState } from "./journeyFilters";
import {
  JOURNEY_SILENCE_PX,
  globalBandHeights,
  planBoard,
} from "./journeyLayout";
import { useClusterInView } from "./useClusterInView";
import { useJourneyBoard } from "./useJourneyBoard";
import { boardCoverage } from "./journeyPages";
import { useJourneyDetail } from "./useJourneyDetail";
import { useRowUnit } from "./useRowUnit";
import { useVisibleColumns } from "./useVisibleColumns";

type SelectedRow = {
  event: JourneyEvent;
  entryId: string | null;
  contextLabel: string;
  origin: JourneyOrigin | undefined;
};

/** Stable empty map, so a render before the plan exists does not break the
 *  memoisation of every cluster below it. */
const NO_BANDS: Map<JourneyPhaseId, number> = new Map();

/** `initialRole` opens the board already narrowed to one role - the cohort layer above
 *  hands down the role the reader descended into. The reader can widen it again. */
export function JourneyBoardView({ initialRole }: { initialRole?: string } = {}) {
  const t = useTranslations("journey");
  const common = useTranslations("common");
  const { board, loading, error, reload } = useJourneyBoard();
  const [filters, setFilters] = useState<JourneyFilterState>(() =>
    initialRole ? withSelectedRole(EMPTY_JOURNEY_FILTERS, initialRole) : EMPTY_JOURNEY_FILTERS
  );
  const [lit, setLit] = useState<LitRow>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sourceOpened, setSourceOpened] = useState(false);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const detail = useJourneyDetail();
  const columns = useVisibleColumns();

  // `t.has` is what separates "nothing happened, and here is why" from "never
  // recorded". Wrapped so the plan stays a pure function of data + a predicate.
  const hasKey = useCallback((key: string) => t.has(key as Parameters<typeof t.has>[0]), [t]);

  const filtered = useMemo(() => (board ? filterBoard(board, filters) : null), [board, filters]);
  const plan = useMemo(
    () => (filtered ? planBoard(filtered, { hasKey, observedOnly: filters.observedOnly }) : null),
    [filtered, hasKey, filters.observedOnly]
  );

  const unit = useRowUnit(scrollerRef, plan === null ? 0 : `${plan.totals.columns}:${columns.mountedCount}`);
  const heights = useMemo(
    () => (plan ? globalBandHeights(plan, unit, JOURNEY_SILENCE_PX) : null),
    [plan, unit]
  );

  // WHICH CLUSTER THE ONE RAIL IS DESCRIBING. Derived from the scroller rather
  // than from a selection: the reader travels sideways, and the rail has to
  // follow them or it silently starts describing the wrong role.
  const activeIndex = useClusterInView(scrollerRef, trackRef, plan?.clusters.length ?? 0, plan);
  const activeCluster = plan?.clusters[activeIndex] ?? null;
  const activeJobId = activeCluster?.cluster.jobId ?? null;

  // eventId -> everything the fact card needs, built once per plan.
  const index = useMemo(() => {
    const map = new Map<string, SelectedRow>();
    if (!plan) return map;
    for (const cluster of plan.clusters) {
      for (const cell of cluster.shared) {
        map.set(cell.event.id, {
          event: cell.event,
          entryId: null,
          contextLabel: cluster.cluster.title,
          origin: undefined,
        });
      }
      for (const column of cluster.columns) {
        for (const event of column.column.events) {
          map.set(event.id, {
            event,
            entryId: column.column.entryId,
            contextLabel: `${column.column.candidateLabel} · ${cluster.cluster.title}`,
            origin: column.column.origin,
          });
        }
      }
    }
    return map;
  }, [plan]);

  const selected = selectedId === null ? null : (index.get(selectedId) ?? null);

  const selectRow = useCallback((_entryId: string | null, eventId: string) => {
    setSelectedId(eventId);
    setSourceOpened(false);
  }, []);
  const closeCard = useCallback(() => {
    setSelectedId(null);
    setSourceOpened(false);
    detail.reset();
  }, [detail]);
  const lightRow = useCallback((jobId: string, phase: JourneyPhaseId, row: number) => {
    setLit((current) =>
      current !== null && current.jobId === jobId && current.phase === phase && current.row === row
        ? null
        : { jobId, phase, row }
    );
  }, []);

  // The rail lights a row in the cluster it is currently describing — never in
  // "the board", which has no shared row 4.
  const lightActiveRow = useCallback(
    (phase: JourneyPhaseId, row: number) => {
      if (activeJobId === null) return;
      lightRow(activeJobId, phase, row);
    },
    [lightRow, activeJobId]
  );

  const jumpToRole = useCallback((jobId: string) => {
    const scroller = scrollerRef.current;
    const track = trackRef.current;
    const section = track?.querySelector<HTMLElement>(`[data-jr-cluster="${CSS.escape(jobId)}"]`);
    if (!scroller || !track || !section) return;
    // MINUS THE RAIL. A section's `offsetLeft` counts the rail, because the rail
    // is the track's first flex child; scrolling straight to it would park the
    // cluster's first 16rem underneath the sticky rail — its title, its shared
    // band's opening line and its first column's header, all covered. Landing
    // the cluster at the rail's RIGHT edge is also what makes the arrival
    // unambiguous to `clusterIndexInView`, which reads the same offset.
    const railPx = track.querySelector<HTMLElement>("[data-jr-rail]")?.offsetWidth ?? 0;
    scroller.scrollTo({ left: Math.max(0, section.offsetLeft - railPx), behavior: "smooth" });
  }, []);

  // The find box NARROWS the board rather than only jumping, so a search with no
  // hit is visible rather than silently leaving the reader where they were. The
  // one thing it still owes is putting the first hit on screen.
  useEffect(() => {
    if (filters.find.trim() === "") return;
    scrollerRef.current?.scrollTo({ left: 0, behavior: "auto" });
  }, [filters.find]);

  // The picker groups by area, so it needs the area — and `null` is a real
  // state it must render as "other roles" rather than invent a bucket for.
  const roles = useMemo(
    () =>
      board
        ? board.clusters.map((c) => ({ jobId: c.jobId, title: c.title, roleArea: c.roleArea }))
        : [],
    [board]
  );

  const coverage = board ? boardCoverage(board) : null;
  const capped = coverage && coverage.shown < coverage.total ? coverage : null;

  if (loading && !board) {
    return (
      <div className="h-full p-5">
        <LoadingGap className="min-h-48" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full p-5">
        <div className={`${NOTICE("critical")} p-4`} role="alert">
          <p className="text-sm">{error}</p>
          <button type="button" onClick={reload} className={`${BTN_SECONDARY} mt-3 h-9 px-3 text-sm`}>
            {common("retry")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <JourneyToolbar filters={filters} onChange={setFilters} roles={roles} capped={capped} />
      {plan && plan.clusters.length > 0 ? (
        <JourneyMinimap plan={plan} scrollerRef={scrollerRef} onJumpToRole={jumpToRole} />
      ) : null}

      <div className="flex min-h-0 flex-1">
        {/* The ONE scroller. The overlay owns the viewport, so nothing here may
            introduce a second page-level scroll; both axes live on this box. */}
        <div ref={scrollerRef} className="min-w-0 flex-1 overflow-auto bg-paper">
          {plan === null || plan.clusters.length === 0 ? (
            // MISSING CATALOG KEY (reported, not worked around): there is no
            // `journey.noMatches`, so a filtered-to-nothing board borrows the
            // unfiltered empty line. It is the one string on this surface that
            // is not exactly right.
            <div className="p-5">
              <div className={`${PANEL} p-6 text-sm text-steel`}>{t("empty")}</div>
            </div>
          ) : (
            <div ref={trackRef} className="flex w-max items-start pb-16">
              {/* ONE rail, first in the track and `sticky left-0`, so it stays
                  at the reader's left edge while the clusters travel under it.
                  Its steps and its title are the ACTIVE cluster's; the rungs
                  line up with every cluster because `globalBandHeights` pads
                  all of them to one height. */}
              {activeCluster ? (
                <JourneyRail
                  cluster={activeCluster}
                  phases={plan.columnPhases}
                  bandPx={heights?.phases ?? NO_BANDS}
                  sharedPx={heights?.shared ?? 0}
                  unit={unit}
                  silencePx={JOURNEY_SILENCE_PX}
                  lit={lit}
                  onLight={lightActiveRow}
                />
              ) : null}
              {plan.clusters.map((cluster) => (
                <div key={cluster.cluster.jobId} data-jr-cluster={cluster.cluster.jobId} className="flex flex-none">
                  <JourneyCluster
                    plan={cluster}
                    phases={plan.columnPhases}
                    bandPx={heights?.phases ?? NO_BANDS}
                    sharedPx={heights?.shared ?? 0}
                    unit={unit}
                    silencePx={JOURNEY_SILENCE_PX}
                    lit={lit}
                    selectedEventId={selectedId}
                    onSelectRow={selectRow}
                    isMounted={columns.isMounted}
                    observe={columns.observe}
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        {selected ? (
          <JourneyFactCard
            event={selected.event}
            entryId={selected.entryId}
            contextLabel={selected.contextLabel}
            origin={selected.origin}
            detail={detail.detail}
            detailLoading={detail.loading}
            detailError={detail.error}
            sourceOpened={sourceOpened}
            onOpenSource={
              selected.entryId === null
                ? null
                : () => {
                    setSourceOpened(true);
                    detail.load(selected.entryId as string, selected.event.id);
                  }
            }
            onClose={closeCard}
          />
        ) : null}
      </div>
    </div>
  );
}
