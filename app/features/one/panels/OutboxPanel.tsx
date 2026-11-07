"use client";

// outbox — GET /api/comms?limit=8: the newest messages to candidates, each with the ONE
// delivery verdict every comms surface renders (commsVerdict in app/_lib/comms-view.ts).
// When no relay is configured the panel says, before any row, that nothing reaches
// candidates — a calm "queued" badge would be a green lie.
import { useTranslations } from "next-intl";
import { Mark, Note, type MarkKind } from "@/app/_components/kit";
import { useDateFormat } from "@/app/_components/ui/useDateFormat";
import { commsVerdict, type CommsVerdict } from "@/app/_lib/comms-view";
import type { OutboxStatus } from "@/app/_lib/comms-status";
import { tally } from "./insight";
import { NameCell, PanelFrame } from "./PanelFrame";
import { useRead } from "./read";
import type { PanelProps } from "./types";

type Message = { id: string; who: string | null; subject: string | null; verdict: CommsVerdict; at: string };
type OutboxRead = { messages: Message[]; relayConfigured: boolean | null };

const OUTBOX_URL = "/api/comms?limit=8";

const MARK_OF: Record<CommsVerdict, MarkKind> = {
  sent: "ok",
  queued: "wait",
  failed: "fail",
  bounced: "bounce",
  recovered: "recovered",
  orphaned: "unknown",
};

export function parseOutbox(body: unknown): OutboxRead | null {
  if (body == null || typeof body !== "object") return null;
  const b = body as { messages?: unknown; entries?: unknown; relayConfigured?: unknown };
  if (!Array.isArray(b.messages)) return null;
  const entries = (b.entries != null && typeof b.entries === "object" ? b.entries : {}) as Record<string, { label?: unknown }>;
  const messages: Message[] = [];
  for (const raw of b.messages as unknown[]) {
    if (raw == null || typeof raw !== "object") continue;
    const m = raw as Record<string, unknown>;
    if (typeof m.id !== "string" || typeof m.status !== "string" || typeof m.createdAt !== "string") continue;
    const ref = typeof m.ref === "string" ? m.ref : null;
    const label = ref && typeof entries[ref]?.label === "string" ? (entries[ref].label as string) : null;
    messages.push({
      id: m.id,
      who: label ?? (typeof m.recipient === "string" ? m.recipient : null),
      subject: typeof m.subject === "string" ? m.subject : null,
      verdict: commsVerdict({
        status: m.status as OutboxStatus,
        bounced: m.bounced === true,
        recovered: m.recovered === true,
        orphaned: m.orphaned === true,
      }),
      at: m.createdAt,
    });
  }
  return { messages, relayConfigured: typeof b.relayConfigured === "boolean" ? b.relayConfigured : null };
}

export function OutboxPanel(props: PanelProps) {
  const t = useTranslations("one.core.panels");
  const fmt = useDateFormat();
  const read = useRead(OUTBOX_URL, parseOutbox, props.epoch);
  const data = read.state === "ready" ? read.data : null;
  const latest = data?.messages[0];
  const trouble = data ? data.messages.filter((m) => m.verdict === "failed" || m.verdict === "bounced").length : 0;
  return (
    <PanelFrame
      props={props}
      data={{
        title: t("outbox.title"),
        count: data ? data.messages.length : null,
        insight: data
          ? {
              shape: {
                label: t("insight.delivery", { count: data.messages.length }),
                parts: tally(data.messages.map((m) => m.verdict)).map((v) => ({ key: v.key, label: t(`outbox.verdict.${v.key}`), value: v.count })),
              },
              facts: [
                ...(latest
                  ? [{ key: "latest", label: t("insight.latest"), value: latest.who ?? t("notReturned"), sub: [t(`outbox.verdict.${latest.verdict}`), fmt.dayTime(latest.at)].join(" · "), mark: MARK_OF[latest.verdict] }]
                  : []),
                { key: "trouble", label: t("insight.trouble"), value: trouble > 0 ? t("insight.troubleCount", { count: trouble }) : t("insight.troubleNone"), mark: trouble > 0 ? ("fail" as const) : ("ok" as const) },
              ],
            }
          : undefined,
        console: { tab: "channels" },
        read,
        cols: [
          { key: "name", label: t("cols.candidate"), track: "minmax(0,1.6fr)" },
          { key: "status", label: t("cols.status"), track: "9rem" },
          { key: "at", label: t("cols.sent"), track: "10rem", end: true },
        ],
        actsTrack: "0",
        note: data?.relayConfigured === false ? <Note tone="caution">{t("outbox.relayOff")}</Note> : null,
        rows: (data?.messages ?? []).map((m) => ({
          key: m.id,
          cells: {
            name: <NameCell name={m.who ?? t("notReturned")} sub={m.subject ?? undefined} />,
            status: (
              <span className="flex items-center gap-2">
                <Mark kind={MARK_OF[m.verdict]} tip={t(`outbox.verdict.${m.verdict}`)} />
                {t(`outbox.verdict.${m.verdict}`)}
              </span>
            ),
            at: <span className="text-steel">{fmt.dayTime(m.at)}</span>,
          },
          line: m.who ?? t("notReturned"),
          meta: [t(`outbox.verdict.${m.verdict}`), m.subject].filter(Boolean).join(" · "),
          trail: fmt.dayTime(m.at),
          mark: MARK_OF[m.verdict],
        })),
        empty: t("outbox.empty"),
      }}
    />
  );
}
