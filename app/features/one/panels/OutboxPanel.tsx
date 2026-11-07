"use client";

// outbox — GET /api/comms?limit=8: the newest messages to candidates, each with the ONE
// delivery verdict every comms surface renders (commsVerdict in app/_lib/comms-view.ts).
// When no relay is configured the panel says, before any row, that nothing reaches
// candidates — a calm "queued" badge would be a green lie.
import { useTranslations } from "next-intl";
import { ListRow, Mark, Note, type MarkKind } from "@/app/_components/kit";
import { useDateFormat } from "@/app/_components/ui/useDateFormat";
import { commsVerdict, type CommsVerdict } from "@/app/_lib/comms-view";
import type { OutboxStatus } from "@/app/_lib/comms-status";
import { EmptyLine, PanelShell } from "./PanelShell";
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
  return (
    <PanelShell props={props} title={t("outbox.title")} read={read} console={{ tab: "channels" }}>
      {data?.relayConfigured === false ? <Note tone="caution">{t("outbox.relayOff")}</Note> : null}
      {data && data.messages.length === 0 ? <EmptyLine>{t("outbox.empty")}</EmptyLine> : null}
      {data
        ? data.messages.map((m) => (
            <ListRow
              key={m.id}
              rowKey={m.id}
              mark={<Mark kind={MARK_OF[m.verdict]} tip={t(`outbox.verdict.${m.verdict}`)} />}
              name={m.who ?? t("notReturned")}
              sub={m.subject ?? undefined}
              meta={t(`outbox.verdict.${m.verdict}`)}
              time={fmt.dayTime(m.at)}
            />
          ))
        : null}
    </PanelShell>
  );
}
