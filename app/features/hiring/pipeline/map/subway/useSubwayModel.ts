"use client";

// The Subway board's derived model: entries bucketed per (line × station), the
// candidates stranded on a column this axis does not draw, who each line's candidates
// are waiting on, and the grid geometry. Pure derivation over props — no state.

import { useMemo } from "react";
import type { InterviewPlanRule } from "@/app/_lib/decision-config-schema";
import type { StageDef } from "@/app/_lib/pipeline-stages";
import type { Entry, Position } from "@/app/features/shared/pipelineTypes";
import { bucketLaneEntries, offAxisEntries } from "../../pipelineBoardLayout";
import { lineAttention, type LineAttention } from "./lineAttention";
import { LINE_COL, STATION_COL } from "./subwayGeometry";

export function useSubwayModel(
  positions: Position[],
  entries: Entry[],
  axis: readonly StageDef[],
  plan: InterviewPlanRule | null,
) {
  const columns = useMemo(() => axis.map((s) => s.id), [axis]);
  // Same derivation as the shipped board: ONE bucketing pass, and candidates on a
  // column this axis does not draw are surfaced in their own strip rather than
  // folded into the first station.
  const cellsByLane = useMemo(() => bucketLaneEntries(positions, entries, columns), [positions, entries, columns]);
  const stranded = useMemo(() => offAxisEntries(entries, columns), [entries, columns]);

  // Per line: how many candidates wait on a PERSON and how many on the AI, read from
  // each step's executor in the hiring plan (lineAttention.ts).
  const attentionByLane = useMemo(() => {
    const map = new Map<string, LineAttention>();
    for (const pos of positions) map.set(pos.id, lineAttention(cellsByLane.get(pos.id) ?? [], axis, plan));
    return map;
  }, [positions, cellsByLane, axis, plan]);

  const gridStyle = useMemo<React.CSSProperties>(
    () => ({ gridTemplateColumns: `${LINE_COL}px repeat(${columns.length}, minmax(${STATION_COL}px, 1fr))` }),
    [columns.length],
  );
  const minWidth = useMemo<React.CSSProperties>(
    () => ({ minWidth: LINE_COL + columns.length * STATION_COL }),
    [columns.length],
  );
  // The far-right end cap is drawn only when the axis really ends in a terminal
  // stage — the axis is workspace data, and inventing a "Hired" terminus for a
  // board that has none would be a lie drawn in moss.
  const terminal = axis.length > 0 && axis[axis.length - 1].role === "terminal";

  return { columns, cellsByLane, stranded, attentionByLane, gridStyle, minWidth, terminal };
}
