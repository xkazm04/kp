"use client";

// decisionsQueue — GET /api/pipeline (what the Decisions tab's own queue reads,
// useDecisionsQueue.ts), the active entries standing on a recognised human approval gate
// (needsHumanDecision, the predicate the sidebar's decisions badge counts). Each row
// offers Advance / Reject as the USER's press (a quiet icon pair in the table, or the row's
// `a` / `r` keys), which arms a ConsentCard; nothing here writes. The proposal carries the
// stage the user saw, so the door's compare-and-swap refuses a decision made on a stale row.
import { useTranslations } from "next-intl";
import { Button } from "@/app/_components/kit";
import { PanelFrame } from "./PanelFrame";
import { rowLimit } from "./cells";
import { matchesRole, parsePipeline } from "./pipelineRead";
import { useEntryCols, useEntryInsight, useEntryRow } from "./PipelineSlicePanel";
import { useRead } from "./read";
import type { PanelProps } from "./types";

export function DecisionsQueuePanel(props: PanelProps) {
  const t = useTranslations("one.core.panels");
  const { params } = props.panel;
  const read = useRead("/api/pipeline", parsePipeline, props.epoch);
  const cols = useEntryCols();
  const entryRow = useEntryRow();
  const insightOf = useEntryInsight();
  const all = read.state === "ready" ? read.data.entries : [];
  const rows = all.filter((e) => e.needsDecision && matchesRole(e, params.role));
  const limit = rowLimit(props.look);
  return (
    <PanelFrame
      props={props}
      data={{
        title: t("decisionsQueue.title"),
        count: rows.length,
        console: { tab: "decisions" },
        read,
        cols,
        actsTrack: "5rem",
        keyHint: t("decisionsQueue.keys"),
        rows: rows.slice(0, limit).map((e) => {
          const act = { entryId: e.id, expectedStage: e.stage, label: e.label, ...(e.jobTitle ? { role: e.jobTitle } : {}) };
          const advance = () => props.onPropose("entryAdvance", act);
          const reject = () => props.onPropose("entryReject", act);
          return entryRow(e, {
            tone: "needs",
            door: undefined,
            keys: { a: advance, r: reject },
            acts: (
              <>
                <Button label={t("decisionsQueue.advanceWho", { label: e.label })} icon="check" iconOnly variant="ghost" size="sm" onClick={advance} data-act="advance" />
                <Button label={t("decisionsQueue.rejectWho", { label: e.label })} icon="x" iconOnly variant="ghost" size="sm" onClick={reject} data-act="reject" />
              </>
            ),
          });
        }),
        insight: props.look === "insight" ? insightOf(rows, props.onPropose) : undefined,
        empty: t("decisionsQueue.empty"),
        foot: rows.length > limit ? t("firstOf", { shown: limit, total: rows.length }) : undefined,
      }}
    />
  );
}
