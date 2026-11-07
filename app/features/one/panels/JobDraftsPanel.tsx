"use client";

// jobDrafts — GET /api/jobs/status: the roles still sitting as drafts (the cohort the
// sidebar's jobs badge counts), newest first, each with its Console door on the Jobs tab.
import { useTranslations } from "next-intl";
import { ListRow, Mark } from "@/app/_components/kit";
import { ConsoleLink, EmptyLine, PanelShell } from "./PanelShell";
import { ROW_LIMIT } from "./PipelineSlicePanel";
import { useRead } from "./read";
import type { PanelProps } from "./types";

type Draft = { id: string; title: string; company: string | null };

export function parseDrafts(body: unknown): Draft[] | null {
  if (body == null || typeof body !== "object") return null;
  const drafts = (body as { drafts?: unknown }).drafts;
  if (!Array.isArray(drafts)) return null;
  return drafts.flatMap((d) =>
    d != null && typeof d === "object" && typeof (d as Draft).id === "string" && typeof (d as Draft).title === "string"
      ? [{ id: (d as Draft).id, title: (d as Draft).title, company: typeof (d as Draft).company === "string" ? (d as Draft).company : null }]
      : []
  );
}

export function JobDraftsPanel(props: PanelProps) {
  const t = useTranslations("one.core.panels");
  const read = useRead("/api/jobs/status", parseDrafts, props.epoch);
  const drafts = read.state === "ready" ? read.data : null;
  const shown = drafts ? drafts.slice(0, ROW_LIMIT) : [];
  return (
    <PanelShell props={props} title={t("jobDrafts.title")} count={drafts ? drafts.length : undefined} read={read} console={{ tab: "jobs" }}>
      {drafts && drafts.length === 0 ? <EmptyLine>{t("jobDrafts.empty")}</EmptyLine> : null}
      {shown.map((d) => (
        <ListRow
          key={d.id}
          rowKey={d.id}
          mark={<Mark kind="wait" />}
          name={d.title}
          sub={d.company ?? undefined}
          actions={<ConsoleLink tab="jobs" params={{ job: d.id }} />}
        />
      ))}
      {drafts && drafts.length > shown.length ? <EmptyLine>{t("firstOf", { shown: shown.length, total: drafts.length })}</EmptyLine> : null}
    </PanelShell>
  );
}
