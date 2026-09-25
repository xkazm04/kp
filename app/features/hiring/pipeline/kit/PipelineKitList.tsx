"use client";

import { useLocale, useTranslations } from "next-intl";
import { Button, DataTable, Note, Section, formatCount, type PartState } from "@/app/_components/kit";
import type { PipelineTabState } from "../usePipelineTabState";
import type { PipelineKit } from "./usePipelineKit";
import { OUT } from "./pipelineKitModel";
import { PipelineKitBulk } from "./PipelineKitBulk";
import { usePipelineKitCells } from "./PipelineKitCells";

/**
 * "Candidates": the windowed list, waiting-on-you first, then by match (or the chosen sort); a row
 * opens the reading pane, or in select mode toggles its checkbox. The exit layer lists the rejected
 * shelf. A refused move the pane is not showing is stated above the rows, with a dismiss.
 */
export function PipelineKitList({ s, k, status, onEditSla }: { s: PipelineTabState; k: PipelineKit; status: PartState; onEditSla: () => void }) {
  const t = useTranslations("pipeline.kit");
  const tt = useTranslations("pipeline.tab");
  const locale = useLocale();
  const n = (v: number) => formatCount(v, locale);
  const { columns, cells } = usePipelineKitCells(s, k);
  const total = k.entries.length;
  const rejected = k.layers.find((l) => l.exit)?.count ?? 0;
  const picking = s.selectMode;
  const shelf = k.layer === OUT;
  const bounced = s.moveError && s.moveErrorEntryId !== k.open?.id ? s.moveError : null;

  return (
    <Section
      id="pipeline-kit-list"
      title={t("listTitle")}
      count={k.rows.length === total ? n(total) : t("listCount", { shown: k.rows.length, total })}
      state={s.sort === "insertion" ? t("listState") : tt(s.sort === "score" ? "sortScore" : "sortAge")}
      actions={
        <>
          <Button label={picking ? tt("selectDone") : tt("select")} variant={picking ? "secondary" : "ghost"} size="sm" aria-pressed={picking} onClick={s.toggleSelectMode} />
          <Button label={tt("agingSlas")} tip={tt("agingSlasTitle")} variant="ghost" size="sm" onClick={onEditSla} />
        </>
      }
    >
      {picking ? <PipelineKitBulk s={s} k={k} /> : null}
      {bounced ? <Note tone="critical" action={<Button label={tt("moveErrorDismiss")} variant="ghost" size="sm" onClick={s.dismissMoveError} />}>{bounced}</Note> : null}
      <DataTable
        label={t("listLabel")}
        rows={k.rows}
        columns={columns}
        cells={cells}
        rowKey={(e) => e.id}
        rowState={(e) => [...(k.ctx.needs(e) ? (["needs"] as const) : []), ...(picking && s.selectedIds.has(e.id) ? (["selected"] as const) : [])]}
        visibleRows={10}
        metaSplit="minmax(0,1fr) 150px"
        selectedKey={picking ? null : k.open?.id ?? null}
        // In select mode a row is a checkbox (the board's grammar): a click toggles it, nothing opens.
        onSelect={(id) => {
          const e = picking ? k.rows.find((r) => r.id === id) : null;
          if (e) s.toggleSelected(e);
          else k.select(id);
        }}
        state={shelf && status === "ready" ? (k.shelf.status === "error" ? "error" : k.shelf.status) : status}
        emptyText={shelf ? t("outListEmpty", { count: rejected }) : tt("noMatch")}
        errorText={tt("loadFailed")}
        onRetry={shelf ? k.shelf.retry : () => void s.load()}
        resetKey={k.resetKey}
      />
    </Section>
  );
}
