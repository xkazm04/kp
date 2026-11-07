"use client";

// scheduleAhead — GET /api/schedule: the CONFIRMED invitations whose slot lies ahead (the
// cohort the sidebar's schedule badge counts), soonest first, in the zone the server
// states (`interviewTz`). The route reads a bounded page; when it says `truncated`, the
// panel says there may be more instead of presenting a clipped agenda as complete.
import { useTranslations } from "next-intl";
import { ListRow, Mark } from "@/app/_components/kit";
import { useDateFormat } from "@/app/_components/ui/useDateFormat";
import { ConsoleLink, EmptyLine, PanelShell } from "./PanelShell";
import { ROW_LIMIT } from "./PipelineSlicePanel";
import { useRead } from "./read";
import type { PanelProps } from "./types";

type Ahead = { id: string; label: string | null; jobTitle: string | null; slotAt: string };
type ScheduleRead = { ahead: Ahead[]; zone: string | null; truncated: boolean };

const SCHEDULE_URL = "/api/schedule?limit=200";

export function parseSchedule(body: unknown, now: number = Date.now()): ScheduleRead | null {
  if (body == null || typeof body !== "object") return null;
  const b = body as { invites?: unknown; interviewTz?: unknown; truncated?: unknown };
  if (!Array.isArray(b.invites)) return null;
  const ahead: Ahead[] = [];
  for (const raw of b.invites as unknown[]) {
    if (raw == null || typeof raw !== "object") continue;
    const i = raw as Record<string, unknown>;
    if (i.status !== "confirmed" || typeof i.slotAt !== "string" || typeof i.id !== "string") continue;
    const at = Date.parse(i.slotAt);
    if (!Number.isFinite(at) || at <= now) continue;
    ahead.push({
      id: i.id,
      label: typeof i.candidateLabel === "string" ? i.candidateLabel : null,
      jobTitle: typeof i.jobTitle === "string" ? i.jobTitle : null,
      slotAt: i.slotAt,
    });
  }
  ahead.sort((a, b) => a.slotAt.localeCompare(b.slotAt));
  return { ahead, zone: typeof b.interviewTz === "string" ? b.interviewTz : null, truncated: b.truncated === true };
}

export function ScheduleAheadPanel(props: PanelProps) {
  const t = useTranslations("one.core.panels");
  const fmt = useDateFormat();
  const read = useRead(SCHEDULE_URL, parseSchedule, props.epoch);
  const data = read.state === "ready" ? read.data : null;
  const shown = data ? data.ahead.slice(0, ROW_LIMIT) : [];
  return (
    <PanelShell
      props={props}
      title={t("scheduleAhead.title")}
      count={data ? data.ahead.length : undefined}
      state={data?.zone ? t("scheduleAhead.zone", { zone: data.zone }) : undefined}
      read={read}
      console={{ tab: "schedule" }}
    >
      {data && data.ahead.length === 0 ? <EmptyLine>{t("scheduleAhead.empty")}</EmptyLine> : null}
      {shown.map((i) => (
        <ListRow
          key={i.id}
          rowKey={i.id}
          mark={<Mark kind="wait" />}
          name={i.label ?? t("notReturned")}
          sub={i.jobTitle ?? undefined}
          time={fmt.dayTime(i.slotAt, data?.zone ? { timeZone: data.zone } : undefined)}
          actions={<ConsoleLink tab="schedule" />}
        />
      ))}
      {data && data.ahead.length > shown.length ? <EmptyLine>{t("firstOf", { shown: shown.length, total: data.ahead.length })}</EmptyLine> : null}
      {data?.truncated ? <EmptyLine>{t("scheduleAhead.truncated")}</EmptyLine> : null}
    </PanelShell>
  );
}
