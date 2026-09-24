"use client";

// One candidate's column: a header that stays put, then one band per phase, each
// band a grid of the cluster's canonical steps.
//
// The column is the unit of LAZY MOUNTING. Its outer box always carries the full
// planned height and width, so the track's scroll extent and every row's y
// position are correct before a single sentence exists; the bands inside are
// committed only when `mounted` turns true (useVisibleColumns.ts). The header is
// always drawn — it is one element, it carries the name the find box and the
// minimap read, and a board whose unread columns are anonymous is not a board.

import { memo, useCallback, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { CHIP_QUIET } from "@/app/_components/ui/recipes";
import type { JourneyPhaseId } from "@/app/_lib/journey/types";
import { GeneratedStrip, NeverRecorded, NeverReachedTail, NothingHappened, SkippedCell } from "./JourneyAbsence";
import { JourneyRow } from "./JourneyRow";
import {
  JOURNEY_BAND_LABEL_PX,
  JOURNEY_CLUSTER_HEAD_PX,
  JOURNEY_COLUMN_HEAD_PX,
  JOURNEY_COLUMN_W,
  type ClusterPlan,
  type ColumnPlan,
  rowHeight,
} from "./journeyLayout";

export type JourneyColumnProps = {
  plan: ColumnPlan;
  cluster: ClusterPlan;
  phases: readonly JourneyPhaseId[];
  /** Global band height per phase, px — equal in every cluster. */
  bandPx: Map<JourneyPhaseId, number>;
  unit: number;
  silencePx: number;
  mounted: boolean;
  selectedEventId: string | null;
  onSelect: (entryId: string, eventId: string) => void;
  /** From `useVisibleColumns().observe(entryId)` — stable per column id. */
  columnRef: (node: HTMLElement | null) => void;
};

function isAllGenerated(plan: ColumnPlan, phase: JourneyPhaseId): boolean {
  const state = plan.bands.get(phase)?.state;
  return state !== undefined && state.kind === "rows" && state.allGenerated;
}

function ColumnBandBody({
  plan,
  cluster,
  phase,
  height,
  unit,
  silencePx,
  selectedEventId,
  onSelect,
}: {
  plan: ColumnPlan;
  cluster: ClusterPlan;
  phase: JourneyPhaseId;
  height: number;
  unit: number;
  silencePx: number;
  selectedEventId: string | null;
  onSelect: (eventId: string) => void;
}) {
  const band = plan.bands.get(phase);
  const phasePlan = cluster.phases.get(phase);
  if (!band || !phasePlan) return <div style={{ height }} />;

  if (band.state.kind === "nothing-happened") {
    return <NothingHappened reasonKey={band.state.reasonKey} height={height} />;
  }
  if (band.state.kind === "never-recorded") {
    return <NeverRecorded height={height} />;
  }

  const rowCount = phasePlan.rowCount;
  const tailFrom = band.tailFrom >= 0 ? Math.min(band.tailFrom, rowCount) : rowCount;
  const nodes: ReactNode[] = [];
  let used = 0;

  for (let row = 0; row < tailFrom; row++) {
    const h = rowHeight(unit, phasePlan.silentRows[row] === true, silencePx);
    used += h;
    const cell = band.cells.get(row);
    if (cell) {
      // The row may RESERVE the silence strip because some OTHER column in this
      // cluster went quiet here. If this cell did not, it still owes the space,
      // or its sentences drift out of the grid the rail is measured against.
      const owesSilencePad = phasePlan.silentRows[row] === true && cell.silenceDays === undefined;
      nodes.push(
        <div key={`r${row}`} className="flex shrink-0 flex-col" style={{ height: h }}>
          {owesSilencePad ? <div style={{ height: silencePx }} aria-hidden="true" /> : null}
          <JourneyRow
            event={cell.event}
            origin={plan.column.origin}
            silenceDays={cell.silenceDays}
            height={unit}
            silenceHeight={silencePx}
            selected={selectedEventId === cell.event.id}
            onSelect={onSelect}
          />
        </div>
      );
    } else {
      // A gap BEFORE the journey's last row: the step did not happen and the
      // journey went on without it.
      nodes.push(<SkippedCell key={`s${row}`} height={h} />);
    }
  }

  // Everything from `tailFrom` down is one block, not a stack of empty cells:
  // the journey ended here, and a cohort of these blocks is the funnel's floor.
  const tailHeight = Math.max(0, height - used);
  if (tailFrom < rowCount && tailHeight > 0) {
    nodes.push(<NeverReachedTail key="tail" height={tailHeight} />);
  } else if (tailHeight > 0) {
    nodes.push(<div key="pad" style={{ height: tailHeight }} />);
  }

  return (
    <div className="flex flex-col overflow-hidden" style={{ height }}>
      {nodes}
    </div>
  );
}

function JourneyColumnImpl({
  plan,
  cluster,
  phases,
  bandPx,
  unit,
  silencePx,
  mounted,
  selectedEventId,
  onSelect,
  columnRef,
}: JourneyColumnProps) {
  const t = useTranslations("journey");
  const column = plan.column;
  // ONE closure per column rather than one per row: `JourneyRow` is memoised,
  // and a fresh handler identity per render would make that memo a no-op across
  // ~1,300 rows.
  const selectInColumn = useCallback((eventId: string) => onSelect(column.entryId, eventId), [onSelect, column.entryId]);
  const bodyHeight = phases.reduce((sum, phase) => sum + JOURNEY_BAND_LABEL_PX + (bandPx.get(phase) ?? 0), 0);

  return (
    <article
      ref={columnRef}
      data-jr-column={column.entryId}
      className={`flex ${JOURNEY_COLUMN_W} flex-none flex-col border-r border-stone-200 bg-white`}
      style={{ height: JOURNEY_COLUMN_HEAD_PX + bodyHeight }}
      aria-label={column.candidateLabel}
    >
      <header
        className="sticky z-10 flex shrink-0 flex-col justify-center overflow-hidden border-b-2 border-ink bg-white px-2"
        // Sits directly under the cluster's own sticky title bar.
        style={{ top: JOURNEY_CLUSTER_HEAD_PX, height: JOURNEY_COLUMN_HEAD_PX }}
      >
        <p className="break-words font-serif text-h3 leading-tight text-ink">{column.candidateLabel}</p>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <span className={`${CHIP_QUIET} text-xs`}>{column.stage}</span>
          {column.matchScore !== null ? (
            <span className="nums text-xs text-steel">{column.matchScore}</span>
          ) : null}
          {column.origin.kind === "test-run" ? (
            <span className="rounded-full border border-dashed border-amber-400 px-2 py-0.5 text-xs text-amber-900">
              {t("mark.testRun")}
            </span>
          ) : null}
        </div>
      </header>

      {mounted ? (
        phases.map((phase) => (
          <div key={phase} className="flex shrink-0 flex-col">
            {/* The rail draws the phase's name in this strip; the column's own
                copy of it is where the "every row below is generated" warning
                goes, so the third empty state costs no extra height and lands
                exactly on the rail's band label. */}
            {isAllGenerated(plan, phase) ? (
              <GeneratedStrip height={JOURNEY_BAND_LABEL_PX} />
            ) : (
              <div style={{ height: JOURNEY_BAND_LABEL_PX }} className="shrink-0 border-b border-stone-200 bg-stone-50" />
            )}
            <ColumnBandBody
              plan={plan}
              cluster={cluster}
              phase={phase}
              height={bandPx.get(phase) ?? 0}
              unit={unit}
              silencePx={silencePx}
              selectedEventId={selectedEventId}
              onSelect={selectInColumn}
            />
          </div>
        ))
      ) : (
        // Reserved, not empty: the exact planned height, so nothing below or
        // beside this column moves when it fills.
        <div style={{ height: bodyHeight }} className="shrink-0 bg-stone-50/40" aria-hidden="true" />
      )}
    </article>
  );
}

export const JourneyColumn = memo(JourneyColumnImpl);
