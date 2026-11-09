"use client";

// jobDrafts — GET /api/jobs/status: the roles still sitting as drafts (the cohort the
// sidebar's jobs badge counts), newest first, each with its Console door on the Jobs tab.
import { useTranslations } from "next-intl";
import { ABSENT } from "@/app/_components/kit";
import { ConsoleLink } from "./PanelShell";
import { NameCell, PanelFrame } from "./PanelFrame";
import { rowLimit } from "./cells";
import { tally } from "./insight";
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
  const limit = rowLimit(props.look);
  // The route lists drafts newest first (created_at DESC), so the oldest is the last one.
  const oldest = drafts?.at(-1);
  const companies = drafts ? tally(drafts.flatMap((d) => (d.company ? [d.company] : []))) : [];
  const topCompany = companies.length > 1 && companies[0].count > 1 ? companies[0] : null;
  return (
    <PanelFrame
      props={props}
      data={{
        title: t("jobDrafts.title"),
        count: drafts ? drafts.length : null,
        insight: drafts
          ? {
              facts: [
                ...(oldest ? [{ key: "oldest", label: t("insight.oldestDraft"), value: oldest.title, sub: oldest.company ?? undefined, mark: "wait" as const }] : []),
                ...(topCompany ? [{ key: "company", label: t("insight.topCompany"), value: topCompany.key, sub: t("insight.drafts", { count: topCompany.count }) }] : []),
              ],
            }
          : undefined,
        console: { tab: "jobs" },
        read,
        cols: [
          { key: "name", label: t("cols.role"), track: "minmax(0,1.4fr)" },
          { key: "company", label: t("cols.company"), track: "minmax(0,1fr)" },
        ],
        actsTrack: "8rem",
        rows: (drafts ?? []).slice(0, limit).map((d) => ({
          key: d.id,
          cells: { name: <NameCell name={d.title} mark="wait" />, company: <span className="block truncate text-steel">{d.company ?? ABSENT}</span> },
          line: d.title,
          meta: d.company ?? undefined,
          mark: "wait" as const,
          door: <ConsoleLink tab="jobs" params={{ job: d.id }} />,
        })),
        empty: t("jobDrafts.empty"),
        foot: drafts && drafts.length > limit ? t("firstOf", { shown: limit, total: drafts.length }) : undefined,
      }}
    />
  );
}
