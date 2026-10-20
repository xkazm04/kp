"use client";

import { Fragment, useMemo } from "react";
import { useTranslations } from "next-intl";
import { Button, DataTable, Mark, Section, type Column } from "@/app/_components/kit";
import { canonicalScoreOf } from "@/app/_lib/match-score";
import { needsHumanDecision } from "@/app/_lib/approval-kinds";
import { stageHasRole } from "@/app/_lib/pipeline-stages";
import type { Entry } from "@/app/features/shared/pipelineTypes";
import { boardPopulation } from "../pipelineBoardPopulation";
import type { PipelineTabState } from "../usePipelineTabState";
import type { OrbitWords } from "./orbitWords";
import { Sep } from "./OrbitMarks";

/**
 * The people a link asked for. Every surface that links into the pipeline speaks the board's URL
 * filters (`?q=` a name or a role title from Recent, the palette, Analytics, the job lifecycle strip;
 * `?stage=`, `?source=`, `?quick=`, `?score=`), and usePipelineTabState already applies them
 * (`filteredEntries`). While any is set, this table lists who they match, live rows only, waiting on a
 * human first; a row opens the candidate record with the table as its prev/next. The orbit below still
 * draws everyone. Clearing the filters removes the table and the parameters.
 *
 * Columns keep the retired roles board's order (mark, candidate, stage, source, match, age), so a link
 * or a test that reads "the fifth cell is the match" still does. The match is the canonical MATCH score
 * only: a work-sample transfer score is a different question and reads as absent here.
 */
export function OrbitMatches({ s, words, now }: { s: PipelineTabState; words: OrbitWords; now: number }) {
  const t = useTranslations("pipeline.orbit");
  const tk = useTranslations("pipeline.kit");
  const tt = useTranslations("pipeline.tab");
  const { n } = words;
  const rows = useMemo(() => {
    const live = new Set(boardPopulation(s.filteredEntries).active.map((e) => e.id));
    return s.filteredEntries.filter((e) => live.has(e.id)).sort((a, b) => Number(needsHumanDecision(b.approvalKind)) - Number(needsHumanDecision(a.approvalKind)));
  }, [s.filteredEntries]);

  const columns: Column[] = [
    { id: "mark", label: "", track: "mark" },
    { id: "name", label: tk("colCandidate"), track: "name", primary: true },
    { id: "stage", label: tk("colStage"), track: "meta" },
    { id: "source", label: tk("colSource"), track: "meta+1", quiet: true },
    { id: "match", label: tk("colMatch"), track: "fig", numeric: true },
    { id: "age", label: tk("colAge"), track: "time", numeric: true, tip: tk("colAgeTip") },
  ];
  const days = (e: Entry): number | null => {
    const at = e.stageChangedAt ?? e.createdAt;
    const ms = at ? Date.parse(at) : NaN;
    return Number.isFinite(ms) ? Math.max(0, Math.floor((now - ms) / 86_400_000)) : null;
  };
  const cells = (e: Entry) => {
    const score = canonicalScoreOf(e);
    const age = days(e);
    const waiting = needsHumanDecision(e.approvalKind);
    return [
      waiting ? (
        <Mark key="mark" kind="needs" tip={tk("markWaiting", { what: words.kind(e.approvalKind ?? "") })} />
      ) : stageHasRole(e.stage, "terminal", s.axis) ? (
        <Mark key="mark" kind="ok" tip={tk("markHired")} />
      ) : (
        <Mark key="mark" kind="wait" tip={tk("markActive", { stage: words.stage(e.stage) })} />
      ),
      <Fragment key="name">{e.candidateLabel}<small>{e.jobTitle ?? tk("noRole")}</small></Fragment>,
      <span key="stage">
        {words.stage(e.stage)}
        {e.stageChangedAt ? null : <span className="ob-cellnote"><Sep />{t("placed")}</span>}
        {waiting ? <span className="ob-cellnote ob-w"><Sep />{words.kind(e.approvalKind ?? "")}</span> : null}
      </span>,
      e.sourceChannel ? s.channelName(e.sourceChannel) : <span key="source" className="k-absent" data-tip={tk("sourceNone")} tabIndex={-1}>—</span>,
      score != null ? n(score) : <span key="match" className="k-absent" data-tip={tk("neverScoredTip")} tabIndex={-1}>—</span>,
      age == null ? <span key="age" className="k-absent">—</span> : tk("ageDays", { days: age }),
    ];
  };

  return (
    <Section
      id="pipeline-orbit-matches"
      title={t("matchesTitle")}
      count={n(rows.length)}
      state={s.query ? t("matchesQuery", { q: s.query }) : t("matchesState")}
      actions={<Button label={tt("clearFilters")} variant="ghost" size="sm" onClick={s.clearFilters} />}
    >
      <DataTable
        label={t("matchesTitle")}
        rows={rows}
        columns={columns}
        cells={cells}
        rowKey={(e) => e.id}
        rowState={(e) => (needsHumanDecision(e.approvalKind) ? ["needs"] : [])}
        visibleRows={8}
        metaSplit="minmax(0,1fr) 150px"
        onSelect={(id) => {
          const e = rows.find((r) => r.id === id);
          if (e) s.openCandidate(e, rows, "overview");
        }}
        emptyText={t("matchesEmpty")}
        resetKey={s.visibleScope}
      />
    </Section>
  );
}
