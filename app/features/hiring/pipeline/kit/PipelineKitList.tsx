"use client";

import { Fragment } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Button, DataTable, Mark, Section, formatCount, type Column, type PartState } from "@/app/_components/kit";
import { ShapeMark } from "@/app/_components/kit/graphic";
import { stageHasRole } from "@/app/_lib/pipeline-stages";
import type { Entry } from "@/app/features/shared/pipelineTypes";
import type { PipelineTabState } from "../usePipelineTabState";
import type { PipelineKit } from "./usePipelineKit";
import { ageDays, OUT, provenance } from "./pipelineKitModel";
import { useApprovalWord } from "./useApprovalWord";

/** "Candidates": the windowed list, waiting-on-you first, then by match; a row opens the reading pane. */
export function PipelineKitList({ s, k, status }: { s: PipelineTabState; k: PipelineKit; status: PartState }) {
  const t = useTranslations("pipeline.kit");
  const tt = useTranslations("pipeline.tab");
  const locale = useLocale();
  const approval = useApprovalWord();
  const n = (v: number) => formatCount(v, locale);
  const label = (id: string) => k.layers.find((l) => l.id === id)?.label ?? id;
  const tone = (id: string) => k.layers.find((l) => l.id === id)?.tone ?? "default";
  const total = k.entries.length;
  const rejected = k.layers.find((l) => l.exit)?.count ?? 0;

  const columns: Column[] = [
    { id: "mark", label: "", track: "mark" },
    { id: "name", label: t("colCandidate"), track: "name", primary: true },
    { id: "stage", label: t("colStage"), track: "meta" },
    { id: "source", label: t("colSource"), track: "meta+1", quiet: true },
    { id: "match", label: t("colMatch"), track: "fig", numeric: true },
    { id: "age", label: t("colAge"), track: "time", numeric: true, tip: t("colAgeTip") },
    { id: "act", label: "", track: "act" },
  ];

  const entryMark = (e: Entry) => {
    if (k.ctx.needs(e)) return <Mark kind="needs" tip={t("markWaiting", { what: approval(e.approvalKind) })} />;
    if (stageHasRole(e.stage, "terminal", s.axis)) return <Mark kind="ok" tip={t("markHired")} />;
    return <Mark kind="wait" tip={t("markActive", { stage: label(e.stage) })} />;
  };

  const cells = (e: Entry) => {
    const pv = provenance(e);
    const score = k.ctx.score(e);
    const age = ageDays(e, k.ctx.now);
    const moved = pv === "solid";
    return [
      entryMark(e),
      <Fragment key="name">{e.candidateLabel}<small>{e.jobTitle ?? t("noRole")}</small></Fragment>,
      <span key="stage" className="k-stagecell">
        <ShapeMark shape={pv} tone={tone(e.stage)} tip={t(`prov.${pv}`)} />
        <span>{label(e.stage)}</span>
        {k.ctx.needs(e) ? <span className="k-needs-t">{approval(e.approvalKind)}</span> : null}
      </span>,
      e.sourceChannel ? s.channelName(e.sourceChannel) : <span className="k-absent" data-tip={t("sourceNone")} tabIndex={-1}>—</span>,
      score == null ? <span className="k-absent" data-tip={t("neverScoredTip")} tabIndex={-1}>—</span> : n(score),
      age == null ? (
        <span className="k-absent" data-tip={t("prov.dashed")} tabIndex={-1}>—</span>
      ) : moved ? (
        t("ageDays", { days: age })
      ) : (
        <span className="k-absent" data-tip={t("neverMovedTip")} tabIndex={-1}>{t("ageDays", { days: age })}</span>
      ),
      <Button key="act" label={t("openHistory")} icon="right" iconOnly size="sm" variant="ghost" onClick={(ev) => { ev.stopPropagation(); k.select(e.id); }} />,
    ];
  };

  return (
    <Section
      id="pipeline-kit-list"
      title={t("listTitle")}
      count={k.rows.length === total ? n(total) : t("listCount", { shown: k.rows.length, total })}
      state={t("listState")}
    >
      <DataTable
        label={t("listLabel")}
        rows={k.rows}
        columns={columns}
        cells={cells}
        rowKey={(e) => e.id}
        rowState={(e) => (k.ctx.needs(e) ? ["needs"] : [])}
        visibleRows={10}
        metaSplit="minmax(0,1fr) 150px"
        selectedKey={k.open?.id ?? null}
        onSelect={(id) => k.select(id)}
        state={status}
        emptyText={k.layer === OUT ? t("outListEmpty", { count: rejected }) : tt("noMatch")}
        errorText={tt("loadFailed")}
        onRetry={() => void s.load()}
        resetKey={k.resetKey}
      />
    </Section>
  );
}
