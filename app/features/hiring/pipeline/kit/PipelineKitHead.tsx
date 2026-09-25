"use client";

import { useTranslations } from "next-intl";
import { useDateFormat } from "@/app/_components/ui/useDateFormat";
import { Button, ChipRow, Mark, PageHead, SearchField, Toolbar, type Chip, type PartState } from "@/app/_components/kit";
import { stageHasRole } from "@/app/_lib/pipeline-stages";
import { boardPopulation } from "../pipelineBoardPopulation";
import type { PipelineTabState } from "../usePipelineTabState";
import type { PipelineKit } from "./usePipelineKit";
import { OUT } from "./pipelineKitModel";

/** The page head (three figures, one primary action) and the toolbar (role, chips, search). */
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
  const layerLabel = k.layer === OUT ? t("outLabel") : s.axis.find((a) => a.id === k.layer)?.label ?? k.layer;

  const chips: Chip[] = [
    { id: "needs", label: t("chipWaiting"), count: waiting, mark: <Mark kind="needs" />, pressed: k.needsOnly, disabled: waiting === 0 && !k.needsOnly, onPress: k.toggleNeeds },
    ...(k.layer ? [{ id: "layer", label: t("chipClear", { what: layerLabel ?? "" }), pressed: true, onPress: k.clearLayer }] : []),
    ...(k.brush ? [{ id: "brush", label: t("chipBrush", { from: k.brush[0] + 1, to: k.brush[1] + 1 }), pressed: true, onPress: () => k.setBrush(null) }] : []),
  ];

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
        filters={<ChipRow chips={chips} />}
        search={<SearchField label={tt("searchLabel")} value={s.query} onChange={s.setQueryAndSync} />}
      />
    </>
  );
}
