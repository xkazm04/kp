"use client";

// scheduleAhead — GET /api/schedule: the CONFIRMED invitations whose slot lies ahead (the
// cohort the sidebar's schedule badge counts), soonest first, in the zone the server
// states (`interviewTz`). The route reads a bounded page; when it says `truncated`, the
// panel says there may be more instead of presenting a clipped agenda as complete.
import { useTranslations } from "next-intl";
import { ABSENT } from "@/app/_components/kit";
import { useDateFormat } from "@/app/_components/ui/useDateFormat";
import { ConsoleLink } from "./PanelShell";
import { NameCell, PanelFrame } from "./PanelFrame";
import { rowLimit } from "./cells";
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
  const limit = rowLimit(props.look);
  const when = (iso: string) => fmt.dayTime(iso, data?.zone ? { timeZone: data.zone } : undefined);
  const foot = data
    ? [data.ahead.length > limit ? t("firstOf", { shown: limit, total: data.ahead.length }) : null, data.truncated ? t("scheduleAhead.truncated") : null].filter(Boolean).join(" ")
    : "";
  return (
    <PanelFrame
      props={props}
      data={{
        title: t("scheduleAhead.title"),
        count: data ? data.ahead.length : null,
        state: data?.zone ? t("scheduleAhead.zone", { zone: data.zone }) : undefined,
        headline: { figure: data ? data.ahead.length : "", label: t("scheduleAhead.title") },
        console: { tab: "schedule" },
        read,
        cols: [
          { key: "when", label: t("cols.when"), track: "11rem" },
          { key: "name", label: t("cols.candidate"), track: "minmax(0,1fr)" },
          { key: "role", label: t("cols.role"), track: "minmax(0,1fr)" },
        ],
        actsTrack: "8rem",
        rows: (data?.ahead ?? []).slice(0, limit).map((i) => ({
          key: i.id,
          cells: {
            when: <span className="k-nums font-semibold">{when(i.slotAt)}</span>,
            name: <NameCell name={i.label ?? t("notReturned")} />,
            role: <span className="block truncate text-steel">{i.jobTitle ?? ABSENT}</span>,
          },
          line: `${when(i.slotAt)} · ${i.label ?? t("notReturned")}`,
          meta: i.jobTitle ?? undefined,
          door: <ConsoleLink tab="schedule" />,
        })),
        empty: t("scheduleAhead.empty"),
        foot: foot || undefined,
      }}
    />
  );
}
