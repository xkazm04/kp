"use client";

import { useState } from "react";
import { RefreshCw, Send } from "lucide-react";
import { useTranslations } from "next-intl";
import { LoadStatus } from "@/app/_components/LoadStatus";
import { formatRelativeTime } from "@/app/_lib/format";
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
  const [state, setState] = useState<"idle" | "busy" | "done" | "deadLettered" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const resend = async () => {
    if (state === "busy" || state === "done") return;
    setState("busy");
    setMessage(null);
    try {
      const r = await fetch(`/api/comms/${encodeURIComponent(id)}/resend`, { method: "POST" });
      const payload = (await r.json().catch(() => null)) as
        | { error?: string; entry?: { status?: string; failureDetail?: string | null } }
        | null;
      if (!r.ok) {
        setMessage(t("resendRejected", { reason: payload?.error ?? t("resendFailed") }));
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
        title="Re-deliver this message through the active channel (recorded as a new outbox row)"
        className={`focus-ring inline-flex shrink-0 items-center gap-1 rounded border border-stone-200 bg-white font-semibold text-coral hover:bg-coral/5 disabled:opacity-50 ${
          compact ? "px-1.5 py-0.5 text-micro" : "px-2 py-1 text-sm"
        }`}
      >
        <RefreshCw size={compact ? 10 : 12} className={state === "busy" ? "animate-spin" : ""} aria-hidden />
        {state === "done" ? "Resent" : adverse ? "Retry resend" : state === "busy" ? "Resending…" : "Resend"}
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
  if (outbox.length === 0) {
    return (
      <div className="space-y-3">
        <LoadStatus state={state} label="the comms outbox" />
        <div className="rounded-lg border border-dashed border-stone-300 bg-white p-10 text-center">
          <Send size={22} className="mx-auto text-steel" aria-hidden />
          <p className="mt-2 text-base font-semibold text-ink">No messages yet</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-steel">
            The pipeline writes every intake acknowledgement, promote invite, recruiter outreach and rejection here
            as cases collect submissions.
          </p>
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <p className="text-micro text-steel">
        &quot;queued&quot; = recorded locally (terminal until a relay is wired); set{" "}
        <span className="font-mono">COMMS_WEBHOOK_URL</span> to relay through a real channel (email / ATS), where
        messages resolve to <span className="text-moss">sent</span> or, on a dropped delivery,{" "}
        <span className="font-semibold text-red-700">failed</span> (dead-lettered — needs attention).
      </p>
      <div className="overflow-hidden rounded-lg border border-stone-200 bg-white shadow-panel">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-stone-200 bg-paper/60 text-micro font-semibold uppercase tracking-wide text-steel">
              <th scope="col" className="px-3 py-2">Kind</th>
              <th scope="col" className="px-3 py-2">Recipient</th>
              <th scope="col" className="px-3 py-2">Subject</th>
              <th scope="col" className="px-3 py-2">Status</th>
              <th scope="col" className="hidden whitespace-nowrap px-3 py-2 sm:table-cell">Sent</th>
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
                    {(m.kind ?? "").replace(/_/g, " ")}
                  </span>
                </td>
                <td className="max-w-0 truncate px-3 py-2 text-sm text-steel sm:max-w-40">{m.recipient}</td>
                <td className="max-w-0 truncate px-3 py-2 text-sm text-ink">{m.subject}</td>
                <td className={`whitespace-nowrap px-3 py-2 text-micro uppercase ${STATUS_STYLE[m.status] ?? "text-steel"}`}>
                  <span className="inline-flex items-center gap-1.5">
                    {m.status === "queued" ? `${m.channel}` : m.status}
                    {m.status === "failed" ? <ResendButton id={m.id} onResent={onResent} compact /> : null}
                  </span>
                </td>
                <td className="hidden whitespace-nowrap px-3 py-2 text-sm text-steel sm:table-cell">
                  {formatRelativeTime(m.createdAt) || "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
