"use client";

// pipelineSlice — GET /api/pipeline, the ACTIVE entries, optionally narrowed to a role
// (the user's own words, matched against the job title or id), to the stalled (the same
// aging tier the sidebar badge counts) or to new arrivals (the axis's entry stage).
// Params: role?, filter? ("aging" | "new").
import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { ListRow, Mark } from "@/app/_components/kit";
import { ConsoleLink, EmptyLine, PanelShell } from "./PanelShell";
import { parsePipeline, sliceEntries, type OneEntry } from "./pipelineRead";
import { useRead } from "./read";
import { ScoreFig } from "./ScoreFig";
import type { PanelProps } from "./types";

export const ROW_LIMIT = 8;

export function EntryRow({ e, actions, needs = false }: { e: OneEntry; actions?: ReactNode; needs?: boolean }) {
  return (
    <ListRow
      rowKey={e.id}
      mark={<Mark kind={e.stale ? "caution" : needs ? "needs" : "wait"} />}
      name={e.label}
      sub={e.jobTitle ?? undefined}
      meta={e.stageLabel}
      fig={<ScoreFig score={e.score} />}
      state={needs ? ["needs"] : []}
      actions={actions ?? <ConsoleLink tab="pipeline" params={{ q: e.label }} />}
    />
  );
}

export function PipelineSlicePanel(props: PanelProps) {
  const t = useTranslations("one.core.panels");
  const { params } = props.panel;
  const read = useRead("/api/pipeline", parsePipeline, props.epoch);
  const rows = read.state === "ready" ? sliceEntries(read.data.entries, params) : [];
  const title =
    params.filter === "aging" ? t("pipelineSlice.titleAging") : params.filter === "new" ? t("pipelineSlice.titleNew") : t("pipelineSlice.title");
  const empty = params.role
    ? t("pipelineSlice.emptyRole", { role: params.role })
    : params.filter === "aging"
      ? t("pipelineSlice.emptyAging")
      : params.filter === "new"
        ? t("pipelineSlice.emptyNew")
        : t("pipelineSlice.empty");
  const shown = rows.slice(0, ROW_LIMIT);
  return (
    <PanelShell
      props={props}
      title={title}
      count={read.state === "ready" ? rows.length : undefined}
      state={params.role ? t("pipelineSlice.forRole", { role: params.role }) : undefined}
      read={read}
      console={{ tab: "pipeline", params: params.role ? { role: params.role } : {} }}
    >
      {read.state === "ready" && rows.length === 0 ? <EmptyLine>{empty}</EmptyLine> : null}
      {shown.map((e) => (
        <EntryRow key={e.id} e={e} />
      ))}
      {rows.length > shown.length ? <EmptyLine>{t("firstOf", { shown: shown.length, total: rows.length })}</EmptyLine> : null}
    </PanelShell>
  );
}
