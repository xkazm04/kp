"use client";

// pipelineSlice — GET /api/pipeline, the ACTIVE entries, optionally narrowed to a role
// (the user's own words, matched against the job title or id), to the stalled (the same
// aging tier the sidebar badge counts) or to new arrivals (the axis's entry stage).
// Params: role?, filter? ("aging" | "new").
import { useTranslations } from "next-intl";
import { Mark } from "@/app/_components/kit";
import { ConsoleLink } from "./PanelShell";
import { CellTag, NameCell, PanelFrame, type Col, type PanelRow } from "./PanelFrame";
import { rowLimit, useDays } from "./cells";
import { parsePipeline, sliceEntries, type OneEntry } from "./pipelineRead";
import { useRead } from "./read";
import { ScoreBar, ScoreFig } from "./ScoreFig";
import type { PanelProps } from "./types";

export const ROW_LIMIT = 8;

/** The columns the two pipeline views share (decisionsQueue adds its acts). */
export function useEntryCols(): Col[] {
  const t = useTranslations("one.core.panels.cols");
  return [
    { key: "name", label: t("candidate"), track: "minmax(0,1.6fr)" },
    { key: "stage", label: t("stage"), track: "minmax(6rem,1fr)" },
    { key: "score", label: t("score"), track: "8.5rem", end: true },
    { key: "age", label: t("inStage"), track: "6rem", end: true },
  ];
}

export function useEntryRow(): (e: OneEntry, extra?: Pick<PanelRow, "acts" | "door" | "tone">) => PanelRow {
  const t = useTranslations("one.core.panels");
  const days = useDays();
  return (e, extra) => ({
    key: e.id,
    cells: {
      name: <NameCell name={e.label} sub={e.jobTitle} />,
      stage: <CellTag>{e.stageLabel}</CellTag>,
      score: <ScoreBar score={e.score} />,
      age: (
        <span className="inline-flex items-center justify-end gap-1.5">
          {e.stale ? <Mark kind="caution" tip={t("stalled")} /> : null}
          {days(e.ageDays)}
        </span>
      ),
    },
    line: e.label,
    meta: [e.stageLabel, e.jobTitle].filter(Boolean).join(" · "),
    trail: <ScoreFig score={e.score} />,
    mark: e.stale ? "caution" : undefined,
    door: <ConsoleLink tab="pipeline" params={{ q: e.label }} />,
    ...extra,
  });
}

export function PipelineSlicePanel(props: PanelProps) {
  const t = useTranslations("one.core.panels");
  const { params } = props.panel;
  const read = useRead("/api/pipeline", parsePipeline, props.epoch);
  const cols = useEntryCols();
  const entryRow = useEntryRow();
  const rows = read.state === "ready" ? sliceEntries(read.data.entries, params) : [];
  const limit = rowLimit(props.look);
  const title =
    params.filter === "aging" ? t("pipelineSlice.titleAging") : params.filter === "new" ? t("pipelineSlice.titleNew") : t("pipelineSlice.title");
  const empty = params.role
    ? t("pipelineSlice.emptyRole", { role: params.role })
    : params.filter === "aging"
      ? t("pipelineSlice.emptyAging")
      : params.filter === "new"
        ? t("pipelineSlice.emptyNew")
        : t("pipelineSlice.empty");
  return (
    <PanelFrame
      props={props}
      data={{
        title,
        count: rows.length,
        state: params.role ? t("pipelineSlice.forRole", { role: params.role }) : undefined,
        headline: { figure: rows.length, label: title },
        console: { tab: "pipeline", params: params.role ? { role: params.role } : {} },
        read,
        cols,
        actsTrack: "8rem",
        rows: rows.slice(0, limit).map((e) => entryRow(e)),
        empty,
        foot: rows.length > limit ? t("firstOf", { shown: limit, total: rows.length }) : undefined,
      }}
    />
  );
}
