"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useErrorMessage } from "@/app/_lib/use-error-message";

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
