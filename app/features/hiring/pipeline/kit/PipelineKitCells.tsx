"use client";

import { Fragment } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Button, Mark, formatCount, type Column } from "@/app/_components/kit";
import { ShapeMark } from "@/app/_components/kit/graphic";
import { SelectBox } from "@/app/_components/kit/SelectBox";
import { stageHasRole } from "@/app/_lib/pipeline-stages";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import { displayScoreOf } from "@/app/_lib/match-score";
import type { Entry } from "@/app/features/shared/pipelineTypes";
import type { PipelineTabState } from "../usePipelineTabState";
import type { PipelineKit } from "./usePipelineKit";
import { ageDays, OUT, provenance } from "./pipelineKitModel";
import { stageName } from "./pipelineKitMoves";
import { useApprovalWord } from "./useApprovalWord";
import { PipelineKitMove } from "./PipelineKitMove";

/**
 * The Candidates list's columns and cells. The mark track is the row's status (or, in select mode,
 * its checkbox; on a refused move, the bounce with the server's reason as its tip); the stage cell
 * says how the entry got there (or, on the rejected shelf, where it was rejected and by whom); the act
 * track holds "Move to…" and the door to the reading pane.
 */
export function usePipelineKitCells(s: PipelineTabState, k: PipelineKit) {
  const t = useTranslations("pipeline.kit");
  const tb = useTranslations("pipeline.board");
  const tr = useTranslations("pipeline.candidateRow");
  const tk = useTranslations("pipeline.scoreKind");
  const locale = useLocale();
  const enumLabel = useEnumLabel();
  const approval = useApprovalWord();
  const n = (v: number) => formatCount(v, locale);
  const label = (id: string) => k.layers.find((l) => l.id === id)?.label ?? id;
  const tone = (id: string) => k.layers.find((l) => l.id === id)?.tone ?? "default";
  const shelf = k.layer === OUT;

  const columns: Column[] = [
    { id: "mark", label: "", track: "mark" },
    { id: "name", label: t("colCandidate"), track: "name", primary: true },
    { id: "stage", label: t("colStage"), track: "meta" },
    { id: "source", label: t("colSource"), track: "meta+1", quiet: true },
    { id: "match", label: t("colMatch"), track: "fig", numeric: true },
    { id: "age", label: t("colAge"), track: "time", numeric: true, tip: t("colAgeTip") },
    { id: "act", label: "", track: "act" },
  ];

  const mark = (e: Entry) => {
    if (s.selectMode && !shelf) return <SelectBox checked={s.selectedIds.has(e.id)} label={tr("selectCandidate", { name: e.candidateLabel })} onToggle={() => s.toggleSelected(e)} />;
    if (s.moveErrorEntryId === e.id && s.moveError) return <Mark kind="bounce" tip={s.moveError} />;
    if (shelf) return <Mark kind="fail" tip={t("outTip")} />;
    if (k.ctx.needs(e)) return <Mark kind="needs" tip={t("markWaiting", { what: approval(e.approvalKind) })} />;
    if (stageHasRole(e.stage, "terminal", s.axis)) return <Mark kind="ok" tip={t("markHired")} />;
    return <Mark kind="wait" tip={t("markActive", { stage: label(e.stage) })} />;
  };

  const stage = (e: Entry) => {
    const tag = shelf ? k.shelf.tags.get(e.id) : undefined;
    if (tag) {
      const at = stageName(tag.stage, s.axis, (x) => enumLabel("stage", x), s.retiredStages);
      return <span key="stage" className="k-stagecell"><ShapeMark shape="exit" tip={null} /><span>{tb(tag.auto ? "rejectedAtByAi" : "rejectedAt", { stage: at })}</span></span>;
    }
    const pv = provenance(e);
    // At <= 1000px of sheet the reason folds out of the cell (kit.css): the tip still carries it.
    return (
      <span key="stage" className="k-stagecell" data-tip={k.ctx.needs(e) ? `${label(e.stage)} · ${approval(e.approvalKind)}` : undefined}>
        <ShapeMark shape={pv} tone={tone(e.stage)} tip={t(`prov.${pv}`)} />
        <span>{label(e.stage)}</span>
        {k.ctx.needs(e) ? <span className="k-needs-t">{approval(e.approvalKind)}</span> : null}
      </span>
    );
  };

  // ONE number per row, and what kind it is: the canonical match, else a work-sample TRANSFER score,
  // labelled and tipped so it is never read as a match (ONE THREAD gap 2), else "—" with its reason.
  const match = (e: Entry, score: number | null) => {
    if (score != null) return n(score);
    const shown = displayScoreOf(e);
    if (shown?.kind === "transfer") {
      return <span key="match" data-tip={tk("transferTitle")} tabIndex={-1}>{n(shown.score)} <small>{tk("transferShort")}</small></span>;
    }
    return <span key="match" className="k-absent" data-tip={t("neverScoredTip")} tabIndex={-1}>—</span>;
  };

  const cells = (e: Entry) => {
    const score = k.ctx.score(e);
    const age = ageDays(e, k.ctx.now);
    const moved = provenance(e) === "solid";
    return [
      mark(e),
      <Fragment key="name">{e.candidateLabel}<small>{e.jobTitle ?? t("noRole")}</small></Fragment>,
      stage(e),
      e.sourceChannel ? s.channelName(e.sourceChannel) : <span className="k-absent" data-tip={t("sourceNone")} tabIndex={-1}>—</span>,
      match(e, score),
      age == null ? (
        <span className="k-absent" data-tip={t("prov.dashed")} tabIndex={-1}>—</span>
      ) : moved ? (
        t("ageDays", { days: age })
      ) : (
        <span className="k-absent" data-tip={t("neverMovedTip")} tabIndex={-1}>{t("ageDays", { days: age })}</span>
      ),
      <Fragment key="act">
        {shelf || s.selectMode ? null : <PipelineKitMove s={s} entry={e} where="row" />}
        <Button label={t("openHistory")} icon="right" iconOnly size="sm" variant="ghost" onClick={(ev) => { ev.stopPropagation(); k.openRow(e.id); }} />
      </Fragment>,
    ];
  };

  return { columns, cells };
}
