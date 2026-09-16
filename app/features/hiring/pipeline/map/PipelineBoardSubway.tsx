"use client";

// Layer 1 of the pipeline map — "Subway": the board read as a transit map.
//
// Every position is a metro LINE: one slim ~40px row with a 2px track running
// left→right across the stage columns, a station circle per stage, and the
// candidates standing there drawn as overlapping 22px beads (initials only). A role
// costs one row, so a whole portfolio is legible at once. A BEAD opens the
// candidate detail modal (openCandidate — named "Actions for {name}", the name the
// old row menu answered to); the STATION / cell opens the layer-2 overlay
// (onOpenCell). Two indicators before each line's title count the candidates waiting
// on a PERSON and on the AI, read from the hiring plan (subway/lineAttention.ts), so
// scanning down the map answers "where am I needed?".
//
// Parts: subway/useSubwayModel (derivation) · SubwayMarks (header, station, badge)
// · SubwayLineRow · SubwayBeads.
//
// Not carried over from the card board yet (the tab still passes the props, this
// board does not read them): select mode, drag-and-drop between stages, the
// bounced-move reason.

import { useTranslations } from "next-intl";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import { displayScoreOf } from "@/app/_lib/match-score";
import type { StageDef } from "@/app/_lib/pipeline-stages";
import { DEFAULT_BOARD_AXIS, STAGE_HELP, type Entry } from "@/app/features/shared/pipelineTypes";
import { PipelineBoardOffAxisStrip } from "../PipelineBoardOffAxisStrip";
import type { MapBoardProps } from "./mapTypes";
import { LineRow } from "./subway/SubwayLineRow";
import { StationHeader } from "./subway/SubwayMarks";
import { useSubwayModel } from "./subway/useSubwayModel";

type PipelineT = ReturnType<typeof useTranslations<"pipeline">>;

/** The bead's tooltip: the name, then which of the 0–100 numbers this is (a
 *  work-sample TRANSFER score is never read as a match score — ONE THREAD gap 2). */
function beadTitle(entry: Entry, t: PipelineT): string {
  const display = displayScoreOf(entry);
  if (!display || display.score == null) return entry.candidateLabel;
  const suffix =
    display.kind === "transfer"
      ? `${t("candidateRow.transferSuffix", { score: display.score })} — ${t("scoreKind.transferTitle")}`
      : t("candidateRow.matchSuffix", { score: display.score });
  return `${entry.candidateLabel}${suffix}`;
}

export function PipelineBoardSubway({
  positions,
  entries,
  axis = DEFAULT_BOARD_AXIS,
  retiredStages = [],
  plan = null,
  rejectedByLane = {},
  onLineAction,
  onOpenRejected,
  openPositionRanking,
  openProfile,
  openJob,
  onMove,
  onOpenCell,
  openCell = null,
  openCandidate,
}: MapBoardProps) {
  const t = useTranslations("pipeline");
  const enumLabel = useEnumLabel();
  const { columns, cellsByLane, stranded, attentionByLane, gridStyle, minWidth, terminal } = useSubwayModel(
    positions,
    entries,
    axis,
    plan,
  );

  // Stage help + label resolution, identical to the baseline: a workspace's own
  // label wins, a shipped stage resolves through the four-locale enum catalog.
  const stageHelp = (s: string): string => {
    const k = `stageHelp.${s}` as Parameters<typeof t>[0];
    return t.has(k) ? t(k) : (STAGE_HELP[s] ?? s);
  };
  const stageLabel = (stage: StageDef): string =>
    stage.label === stage.id ? enumLabel("stage", stage.id) : stage.label;
  const titleOf = (e: Entry) => beadTitle(e, t);
  const labelOf = (e: Entry) => t("candidateRow.menuFor", { name: e.candidateLabel });

  return (
    <section>
      <div tabIndex={0} role="region" aria-label={t("board.boardAria")} className="focus-ring overflow-x-auto bg-white">
        <div
          style={minWidth}
          role="grid"
          aria-label={t("board.gridAria")}
          aria-colcount={columns.length + 1}
          aria-rowcount={positions.length + 1}
        >
          <StationHeader
            axis={axis}
            label={stageLabel}
            help={stageHelp}
            gridStyle={gridStyle}
            lineColLabel={t("board.position")}
          />
          {positions.map((pos) => {
            const attention = attentionByLane.get(pos.id) ?? { human: 0, ai: 0 };
            const rejectedCount = rejectedByLane[pos.id] ?? 0;
            return (
            <LineRow
              key={pos.id}
              position={pos}
              axis={axis}
              cells={cellsByLane.get(pos.id) ?? columns.map(() => [] as Entry[])}
              attention={attention}
              gridStyle={gridStyle}
              openCell={openCell}
              terminal={terminal}
              cellAria={(stage, count) =>
                t("board.cellAria", { position: pos.title, stage, count })
              }
              cellEmpty={t("board.cellEmpty")}
              stageLabel={stageLabel}
              labels={{
                active: t("board.active", { count: pos.count }),
                openJd: t("board.openJd"),
                rank: t("board.rankCandidates"),
                waiting: `${t("board.waitingHuman", { count: attention.human })} · ${t("board.waitingAi", { count: attention.ai })}`,
                rejected: t("board.rejectedCount", { count: rejectedCount, position: pos.title }),
              }}
              rejectedCount={rejectedCount}
              onOpenRejected={(origin) => onOpenRejected(pos, origin)}
              onLineAction={onLineAction ? (action) => onLineAction(pos, action) : undefined}
              beadTitle={titleOf}
              beadLabel={labelOf}
              onOpenCell={onOpenCell}
              openJob={openJob}
              openPositionRanking={openPositionRanking}
              openCandidate={openCandidate}
            />
            );
          })}
        </div>
      </div>

      {/* Candidates standing on a column this board does not draw — loud by
          design, exactly as on the baseline board. */}
      {stranded.length > 0 ? (
        <PipelineBoardOffAxisStrip
          entries={stranded}
          retiredStages={retiredStages}
          openProfile={openProfile}
          onMove={onMove}
          axis={axis}
        />
      ) : null}
    </section>
  );
}
