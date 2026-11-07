"use client";

// decisionsQueue — GET /api/pipeline (what the Decisions tab's own queue reads,
// useDecisionsQueue.ts), the active entries standing on a recognised human approval gate
// (needsHumanDecision, the predicate the sidebar's decisions badge counts). Each row
// offers Advance / Reject as the USER's press, which arms a ConsentCard; nothing here
// writes. The proposal carries the stage the user saw, so the door's compare-and-swap
// refuses a decision made on a stale row.
import { useTranslations } from "next-intl";
import { Button } from "@/app/_components/kit";
import { ConsoleLink, EmptyLine, PanelShell } from "./PanelShell";
import { EntryRow, ROW_LIMIT } from "./PipelineSlicePanel";
import { matchesRole, parsePipeline } from "./pipelineRead";
import { useRead } from "./read";
import type { PanelProps } from "./types";

export function DecisionsQueuePanel(props: PanelProps) {
  const t = useTranslations("one.core.panels");
  const { params } = props.panel;
  const read = useRead("/api/pipeline", parsePipeline, props.epoch);
  const rows = read.state === "ready" ? read.data.entries.filter((e) => e.needsDecision && matchesRole(e, params.role)) : [];
  const shown = rows.slice(0, ROW_LIMIT);
  return (
    <PanelShell
      props={props}
      title={t("decisionsQueue.title")}
      count={read.state === "ready" ? rows.length : undefined}
      read={read}
      console={{ tab: "decisions" }}
    >
      {read.state === "ready" && rows.length === 0 ? <EmptyLine>{t("decisionsQueue.empty")}</EmptyLine> : null}
      {shown.map((e) => {
        const act = { entryId: e.id, expectedStage: e.stage, label: e.label, ...(e.jobTitle ? { role: e.jobTitle } : {}) };
        return (
          <EntryRow
            key={e.id}
            e={e}
            needs
            actions={
              <>
                <Button label={t("decisionsQueue.advance")} variant="affirm" size="sm" onClick={() => props.onPropose("entryAdvance", act)} />
                <Button label={t("decisionsQueue.reject")} variant="ghost" size="sm" onClick={() => props.onPropose("entryReject", act)} />
                <ConsoleLink tab="pipeline" params={{ q: e.label }} />
              </>
            }
          />
        );
      })}
      {rows.length > shown.length ? <EmptyLine>{t("firstOf", { shown: shown.length, total: rows.length })}</EmptyLine> : null}
    </PanelShell>
  );
}
