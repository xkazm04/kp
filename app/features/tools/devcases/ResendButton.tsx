"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { BTN_SECONDARY } from "@/app/_components/ui/recipes";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import { isAdverseResend, resendOutcome, type ResendOutcomeKind } from "@/app/_lib/comms-resend-outcome";

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
// FIVE outcomes, derived ONCE in app/_lib/comms-resend-outcome.ts (this fold used to
// be duplicated verbatim in ChannelsCommsBouncedResend.tsx, and both copies were blind
// to the same one): refused ▸ REFUSED-BUT-RECOVERED (409 + `recovered` — the message
// is already being delivered, so it is calm, never red) ▸ dead-lettered again ▸
// recorded but undeliverable (`queued` — no relay) ▸ actually relayed (`sent`). Only
// the last may say "Resent".
export function ResendButton({ id, onResent, compact = false }: { id: string; onResent?: () => void; compact?: boolean }) {
  const t = useTranslations("channels.comms");
  // The outbox-row copy this button needs beyond the shared comms vocabulary.
  const td = useTranslations("devcase.outbox");
  // Resolve API failures from the machine `code`, never from the server's
  // English `error` — see app/_lib/use-error-message.ts.
  const errMsg = useErrorMessage();
  const [state, setState] = useState<"idle" | "busy" | ResendOutcomeKind>("idle");
  const [message, setMessage] = useState<string | null>(null);
  // Settled and nothing left to do: the message is out (or is going out), so clicking
  // again could only duplicate it. The two adverse outcomes stay clickable — a retry
  // is exactly the recruiter's next move.
  const settled = state === "sent" || state === "queued" || state === "recovered";
  const resend = async () => {
    if (state === "busy" || settled) return;
    setState("busy");
    setMessage(null);
    try {
      const r = await fetch(`/api/comms/${encodeURIComponent(id)}/resend`, { method: "POST" });
      const payload = await r.json().catch(() => null);
      const outcome = resendOutcome(r.ok, r.status, payload);
      setState(outcome.kind);
      switch (outcome.kind) {
        case "refused":
          setMessage(t("resendRejected", { reason: errMsg(outcome, t("resendFailed")) }));
          return;
        case "recovered":
          // 409, but the send HAPPENED — the route refuses a second dispatch of a
          // message already on its way. Reporting "couldn't re-send" over a delivery
          // is the failure this outcome exists to stop.
          setMessage(t("resendRecovered"));
          onResent?.();
          return;
        case "deadLettered":
          // Recorded, but the relay rejected it again — claiming "Resent" here is
          // exactly the false green this state exists to prevent. Refresh either way:
          // the new row is real audit, whatever its outcome.
          setMessage(outcome.detail ? `${t("resendDeadLettered")} ${t("failureDetail", { detail: outcome.detail })}` : t("resendDeadLettered"));
          onResent?.();
          return;
        case "queued":
          // Recorded, but NOTHING WILL DELIVER IT. `queued` is the terminal
          // local-outbox state (comms-status.ts), reached when no relay is configured
          // — and the relay is a stored, UI-editable capability (comms-relay.ts
          // resolves env ▸ stored ▸ nothing), so it can be gone by the time a recruiter
          // chases a dead letter produced while it was wired.
          setMessage(t("relayNotConfigured"));
          onResent?.();
          return;
        default:
          onResent?.();
      }
    } catch {
      setMessage(t("resendFailed"));
      setState("refused");
    }
  };
  const adverse = state !== "idle" && state !== "busy" && isAdverseResend(state);
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <button
        type="button"
        onClick={resend}
        disabled={state === "busy" || settled}
        title={td("resendTitle")}
        // The shared secondary action plus this button's own size/tone. It used to
        // re-type the whole class string, so it missed the dual-theme press-down and
        // border every other secondary control on the surface has.
        className={`${BTN_SECONDARY} shrink-0 font-semibold text-coral hover:bg-coral/5 ${
          compact ? "px-1.5 py-0.5 text-micro" : "px-2 py-1 text-sm"
        }`}
      >
        <RefreshCw size={compact ? 10 : 12} className={state === "busy" ? "animate-spin" : ""} aria-hidden />
        {state === "sent"
          ? t("resent")
          : state === "recovered"
            ? t("statusRecovered")
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
