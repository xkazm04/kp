"use client";

import { useState } from "react";
import { RefreshCw, Send } from "lucide-react";
import { useTranslations } from "next-intl";
import { LoadStatus } from "@/app/_components/LoadStatus";
import { useRelativeTime } from "@/app/_lib/use-relative-time";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import type { LoadState } from "@/app/_lib/useLoader";
import type { OutboxStatus } from "@/app/_lib/comms-status";
import type { OutboxItem } from "./DevTypes";

// W6-1 — re-dispatch a dead-lettered message through the live channel (a NEW
// outbox row; the original stays as the append-only audit record). Shared by
// this table and the Channels Comms Center.
//
// failure-truth-everywhere: this used to `throw new Error()` on !r.ok — discarding the
// server's own explanation (409 "already re-sent", 422 "missing fields", 404) — and to
// flip to "Resent" on any 2xx, INCLUDING the case where the fresh row dead-lettered
// again. Both halves of a resend's outcome are now reported: why the server refused,
// and whether the new send actually landed.
export function ResendButton({ id, onResent, compact = false }: { id: string; onResent?: () => void; compact?: boolean }) {
  const t = useTranslations("channels.comms");
  // The outbox-row copy this button needs beyond the shared comms vocabulary.
  const td = useTranslations("devcase.outbox");
  // Resolve API failures from the machine `code`, never from the server's
  // English `error` — see app/_lib/use-error-message.ts.
  const errMsg = useErrorMessage();
  const [state, setState] = useState<"idle" | "busy" | "done" | "deadLettered" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const resend = async () => {
    if (state === "busy" || state === "done") return;
    setState("busy");
    setMessage(null);
    try {
      const r = await fetch(`/api/comms/${encodeURIComponent(id)}/resend`, { method: "POST" });
      const payload = (await r.json().catch(() => null)) as
        | { error?: string; code?: string; entry?: { status?: string; failureDetail?: string | null } }
        | null;
      if (!r.ok) {
        setMessage(t("resendRejected", { reason: errMsg(payload, t("resendFailed")) }));
        setState("error");
        return;
      }
      // Recorded, but the relay rejected it again — claiming "Resent" here is exactly
      // the false green the dead-letter state exists to prevent. Refresh either way:
      // the new row is real audit, whatever its outcome.
      if (payload?.entry?.status === "failed") {
        const detail = payload.entry.failureDetail;
        setMessage(detail ? `${t("resendDeadLettered")} ${t("failureDetail", { detail })}` : t("resendDeadLettered"));
        setState("deadLettered");
        onResent?.();
        return;
      }
      setState("done");
      onResent?.();
    } catch {
      setMessage(t("resendFailed"));
      setState("error");
    }
  };
  const adverse = state === "error" || state === "deadLettered";
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <button
        type="button"
        onClick={resend}
        disabled={state === "busy" || state === "done"}
        title={td("resendTitle")}
        className={`focus-ring inline-flex shrink-0 items-center gap-1 rounded border border-stone-200 bg-white font-semibold text-coral hover:bg-coral/5 disabled:opacity-50 ${
          compact ? "px-1.5 py-0.5 text-micro" : "px-2 py-1 text-sm"
        }`}
      >
        <RefreshCw size={compact ? 10 : 12} className={state === "busy" ? "animate-spin" : ""} aria-hidden />
        {state === "done" ? t("resent") : adverse ? td("retryResend") : state === "busy" ? t("resending") : t("resend")}
      </button>
      {message ? (
        <span
          role="alert"
          title={message}
          className={`${compact ? "text-micro" : "text-sm"} whitespace-normal ${adverse ? "text-red-700" : "text-steel"}`}
        >
          {message}
        </span>
      ) : null}
    </span>
  );
}

// Badge tints by message kind — positive (invite/outreach/ack) vs. adverse (rejection).
const KIND_STYLE: Record<string, string> = {
  invite: "bg-moss/15 text-moss",
  acknowledgement: "bg-moss/15 text-moss",
  outreach: "bg-coral/15 text-coral",
  rejection: "bg-red-50 text-red-700",
};

// Delivery-status tint — `failed` (dead-letter) is loud so a dropped offer/rejection
// never reads as benign. `queued` shows the channel (local, terminal dev state).
const STATUS_STYLE: Record<OutboxStatus, string> = {
  queued: "text-steel",
  sent: "text-moss",
  failed: "text-red-700 font-semibold",
  bounced: "text-red-800 font-semibold",
};

/** The Outbox tab: every message the pipeline sent, as a full table. */
export function OutboxTable({ outbox, state, onResent }: { outbox: OutboxItem[]; state: LoadState; onResent?: () => void }) {
  const rel = useRelativeTime();
  const t = useTranslations("devcase.outbox");
  const tc = useTranslations("channels.comms");
  const tk = useTranslations("devcase.outboxKind");
  // Message kind + delivery status are enum codes from the store. Render the catalog
  // label when we know the code, else fall back to the raw value (the pipeline may mint
  // a kind before its string lands) — never a blank cell.
  const kindLabel = (kind: string) => {
    const key = kind as Parameters<typeof tk>[0];
    return tk.has(key) ? tk(key) : kind.replace(/_/g, " ");
  };
  const STATUS_KEY = { queued: "statusQueued", sent: "statusSent", failed: "statusFailed", bounced: "statusBounced" } as const;
  if (outbox.length === 0) {
    return (
      <div className="space-y-3">
        <LoadStatus state={state} label="the comms outbox" />
        <div className="rounded-lg border border-dashed border-stone-300 bg-white p-10 text-center">
          <Send size={22} className="mx-auto text-steel" aria-hidden />
          <p className="mt-2 text-base font-semibold text-ink">{t("emptyTitle")}</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-steel">{t("emptyBody")}</p>
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <p className="text-micro text-steel">
        {t.rich("relayHint", {
          code: (chunks) => <span className="font-mono">{chunks}</span>,
          sent: (chunks) => <span className="text-moss">{chunks}</span>,
          failed: (chunks) => <span className="font-semibold text-red-700">{chunks}</span>,
        })}
      </p>
      <div className="overflow-hidden rounded-lg border border-stone-200 bg-white shadow-panel">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-stone-200 bg-paper/60 text-micro font-semibold uppercase tracking-wide text-steel">
              <th scope="col" className="px-3 py-2">{t("colKind")}</th>
              <th scope="col" className="px-3 py-2">{t("colRecipient")}</th>
              <th scope="col" className="px-3 py-2">{t("colSubject")}</th>
              <th scope="col" className="px-3 py-2">{t("colStatus")}</th>
              <th scope="col" className="hidden whitespace-nowrap px-3 py-2 sm:table-cell">{t("colSent")}</th>
            </tr>
          </thead>
          <tbody>
            {outbox.slice(0, 50).map((m, i) => (
              <tr
                key={m.id}
                style={{ animationDelay: `${i * 20}ms` }}
                className="animate-fade-in border-b border-stone-100 last:border-b-0 motion-reduce:animate-none"
              >
                <td className="px-3 py-2">
                  <span className={`rounded-full px-1.5 py-0.5 text-micro font-semibold uppercase ${KIND_STYLE[m.kind ?? ""] ?? "bg-paper text-steel"}`}>
                    {kindLabel(m.kind ?? "")}
                  </span>
                </td>
                <td className="max-w-0 truncate px-3 py-2 text-sm text-steel sm:max-w-40">{m.recipient}</td>
                <td className="max-w-0 truncate px-3 py-2 text-sm text-ink">{m.subject}</td>
                <td className={`whitespace-nowrap px-3 py-2 text-micro uppercase ${STATUS_STYLE[m.status] ?? "text-steel"}`}>
                  <span className="inline-flex items-center gap-1.5">
                    {m.status === "queued" ? `${m.channel}` : tc(STATUS_KEY[m.status] ?? "statusQueued")}
                    {m.status === "failed" ? <ResendButton id={m.id} onResent={onResent} compact /> : null}
                  </span>
                </td>
                <td className="hidden whitespace-nowrap px-3 py-2 text-sm text-steel sm:table-cell">
                  {rel(m.createdAt) || "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
