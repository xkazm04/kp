"use client";

import { useTranslations } from "next-intl";
import { useDateFormat } from "@/app/_components/ui/useDateFormat";
import { Button, Note, PageHead, SearchField, Toolbar, type PartState } from "@/app/_components/kit";
import { stageHasRole } from "@/app/_lib/pipeline-stages";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import { boardPopulation } from "../pipelineBoardPopulation";
import { resolveStageFilter } from "../usePipelineFilters";
import type { PipelineTabState } from "../usePipelineTabState";
import type { PipelineKit } from "./usePipelineKit";
import { PipelineKitFacets } from "./PipelineKitFacets";
import { PipelineKitViews } from "./PipelineKitViews";
import { PipelineKitRole } from "./PipelineKitRole";
import { useSlashSearch } from "./useSlashSearch";

/**
 * The page head (three figures, one primary action), the toolbar (role, search, then the facets and
 * chips on its filter line), the saved-views line, and the one notice a deep link can owe: the
 * `?stage=` it carries is no longer a column here (the filter stays applied, so the list shows who
 * still stands on it, and the notice says why and offers the way out).
 */
export function PipelineKitHead({ s, k, status }: { s: PipelineTabState; k: PipelineKit; status: PartState }) {
  const t = useTranslations("pipeline.kit");
  const tt = useTranslations("pipeline.tab");
  const fmt = useDateFormat();
  // The same population the current tab's stat header counts (real rows, live status).
  const population = boardPopulation(s.entries);
  const hired = population.active.filter((e) => stageHasRole(e.stage, "terminal", s.axis)).length;
  const active = population.active.length - hired;
  const waiting = s.approvals.length;
  const lastMove = k.entries.reduce((m, e) => (e.stageChangedAt && e.stageChangedAt > m ? e.stageChangedAt : m), "");
  const date = lastMove ? fmt.date(lastMove) : null;
  const enumLabel = useEnumLabel();
  const searchRef = useSlashSearch();
  // Only once the axis has arrived can the board say a stage is NOT one of its columns.
  const resolved = s.stageFilter && s.entries != null ? resolveStageFilter(s.stageFilter, s.axis, s.retiredStages) : null;
  const offBoard = resolved != null && !resolved.onBoard;

  return (
    <>
      <PageHead
        eyebrow={tt("eyebrow")}
        title={tt("title")}
        context={
          <>
            {t("context", { count: k.entries.length, roles: k.roles.length })}
            {date ? ` · ${t("lastMove", { date })}` : null}
          </>
        }
        figures={[
          { label: tt("statActive"), value: active, of: population.active.length },
          { label: tt("statAwaitingYou"), value: waiting, tone: waiting > 0 ? "needs" : "default", tip: t("waitingTip") },
          { label: t("hired"), value: hired },
        ]}
        actions={waiting > 0 ? <Button label={t("reviewWaiting", { count: waiting })} variant="primary" onClick={k.reviewWaiting} /> : null}
        state={status}
        errorText={tt("loadFailed")}
        onRetry={() => void s.load()}
      />
      <Toolbar
        segmented={
          <label className="k-field" style={{ width: "auto", maxWidth: 340 }}>
            <select value={k.role ?? ""} onChange={(e) => k.setRole(e.target.value || null)} aria-label={t("roleLabel")}>
              <option value="">{t("roleAll", { count: k.roles.length })}</option>
              {k.roles.map(([title, n]) => (
                <option key={title} value={title}>{t("roleOption", { title, count: n })}</option>
              ))}
            </select>
          </label>
        }
        filters={<PipelineKitFacets s={s} k={k} />}
        search={<span ref={searchRef} className="contents"><SearchField label={tt("searchLabel")} value={s.query} onChange={s.setQueryAndSync} /></span>}
      />
      <PipelineKitViews s={s} />
      <PipelineKitRole s={s} k={k} />
      {offBoard ? (
        <Note tone="caution" action={<Button label={tt("stageOffBoardClear")} variant="ghost" size="sm" onClick={s.clearStageFilter} />}>
          {tt("stageOffBoard", { stage: resolved?.label || enumLabel("stage", s.stageFilter ?? "") })}
        </Note>
      ) : null}
    </>
  );
}
