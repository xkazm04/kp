"use client";

// decisionsQueue — GET /api/pipeline (what the Decisions tab's own queue reads,
// useDecisionsQueue.ts), the active entries standing on a recognised human approval gate
// (needsHumanDecision, the predicate the sidebar's decisions badge counts). Each row
// offers Advance / Reject as the USER's press, which arms a ConsentCard; nothing here
// writes. The proposal carries the stage the user saw, so the door's compare-and-swap
// refuses a decision made on a stale row.
import { useTranslations } from "next-intl";
import { Button } from "@/app/_components/kit";
import { PanelFrame } from "./PanelFrame";
import { rowLimit } from "./cells";
import { matchesRole, parsePipeline } from "./pipelineRead";
import { useEntryCols, useEntryRow } from "./PipelineSlicePanel";
import { useRead } from "./read";
import type { PanelProps } from "./types";

export function DecisionsQueuePanel(props: PanelProps) {
  const t = useTranslations("one.core.panels");
  const { params } = props.panel;
  const read = useRead("/api/pipeline", parsePipeline, props.epoch);
  const cols = useEntryCols();
  const entryRow = useEntryRow();
  const rows = read.state === "ready" ? read.data.entries.filter((e) => e.needsDecision && matchesRole(e, params.role)) : [];
  const limit = rowLimit(props.look);
  return (
    <PanelFrame
      props={props}
      data={{
        title: t("decisionsQueue.title"),
        count: rows.length,
        headline: { figure: rows.length, label: t("decisionsQueue.waiting") },
        console: { tab: "decisions" },
        read,
        cols,
        actsTrack: "11rem",
        rows: rows.slice(0, limit).map((e) => {
          const act = { entryId: e.id, expectedStage: e.stage, label: e.label, ...(e.jobTitle ? { role: e.jobTitle } : {}) };
          return entryRow(e, {
            tone: "needs",
            door: undefined,
            acts: (
              <>
                <Button label={t("decisionsQueue.advance")} variant="secondary" size="sm" onClick={() => props.onPropose("entryAdvance", act)} />
                <Button label={t("decisionsQueue.reject")} variant="ghost" size="sm" onClick={() => props.onPropose("entryReject", act)} />
              </>
            ),
          });
        }),
        empty: t("decisionsQueue.empty"),
        foot: rows.length > limit ? t("firstOf", { shown: limit, total: rows.length }) : undefined,
      }}
    />
  );
}
