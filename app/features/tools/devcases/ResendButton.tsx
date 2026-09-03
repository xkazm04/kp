"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { BTN_SECONDARY } from "@/app/_components/ui/recipes";
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
//
// FOUR outcomes, because the recorded row's own status is the only thing that says
// whether a candidate will receive this: refused (non-2xx) ▸ dead-lettered again
// (`failed`/`bounced`) ▸ recorded but undeliverable (`queued` — no relay) ▸ actually
// relayed (`sent`). Only the last one may say "Resent".
export function ResendButton({ id, onResent, compact = false }: { id: string; onResent?: () => void; compact?: boolean }) {
  const t = useTranslations("channels.comms");
  // The outbox-row copy this button needs beyond the shared comms vocabulary.
  const td = useTranslations("devcase.outbox");
  // Resolve API failures from the machine `code`, never from the server's
  // English `error` — see app/_lib/use-error-message.ts.
  const errMsg = useErrorMessage();
  const [state, setState] = useState<"idle" | "busy" | "done" | "queued" | "deadLettered" | "error">("idle");
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
      // Recorded, but NOTHING WILL DELIVER IT. `queued` is the terminal local-outbox
      // state (comms-status.ts), reached when no relay is configured — and the relay
      // is a stored, UI-editable capability (comms-relay.ts resolves env ▸ stored ▸
      // nothing), so it can be gone by the time a recruiter chases a dead letter that
      // was produced while it was wired. Saying "Resent" for a row that never leaves
      // the building is the same green lie the dead-letter branch below prevents.
      if (payload?.entry?.status === "queued") {
        setMessage(t("relayNotConfigured"));
        setState("queued");
        onResent?.();
        return;
      }
      // Recorded, but the relay rejected it again — claiming "Resent" here is exactly
      // the false green the dead-letter state exists to prevent. Refresh either way:
      // the new row is real audit, whatever its outcome.
      if (payload?.entry?.status === "failed" || payload?.entry?.status === "bounced") {
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
        disabled={state === "busy" || state === "done" || state === "queued"}
        title={td("resendTitle")}
        // The shared secondary action plus this button's own size/tone. It used to
        // re-type the whole class string, so it missed the dual-theme press-down and
        // border every other secondary control on the surface has.
        className={`${BTN_SECONDARY} shrink-0 font-semibold text-coral hover:bg-coral/5 ${
          compact ? "px-1.5 py-0.5 text-micro" : "px-2 py-1 text-sm"
        }`}
      >
        <RefreshCw size={compact ? 10 : 12} className={state === "busy" ? "animate-spin" : ""} aria-hidden />
        {state === "done"
          ? t("resent")
          : state === "queued"
            ? t("statusQueued")
            : adverse
              ? td("retryResend")
              : state === "busy"
                ? t("resending")
                : t("resend")}
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
