"use client";

import { RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { BTN_SECONDARY } from "@/app/_components/ui/recipes";
import { useCommsResend } from "@/app/features/hiring/channels/useCommsResend";

// W6-1 — re-dispatch a dead-lettered message through the live channel (a NEW
// outbox row; the original stays as the append-only audit record). Shared by
// this table and the candidate modal's comms list.
//
// failure-truth-everywhere: this used to `throw new Error()` on !r.ok — discarding the
// server's own explanation (409 "already re-sent", 422 "missing fields", 404) — and to
// flip to "Resent" on any 2xx, INCLUDING the case where the fresh row dead-lettered
// again. Both halves of a resend's outcome are now reported: why the server refused,
// and whether the new send actually landed.
//
// FIVE outcomes, derived ONCE in app/_lib/comms-resend-outcome.ts and folded ONCE into
// state + sentence by useCommsResend (app/features/hiring/channels/useCommsResend.ts),
// the same fold BouncedResend and the Night Post's letter doors render: refused ▸
// REFUSED-BUT-RECOVERED (409 + `recovered` — the message is already being delivered,
// so it is calm, never red) ▸ dead-lettered again ▸ recorded but undeliverable
// (`queued` — no relay) ▸ actually relayed (`sent`). Only the last may say "Resent".
// Settled (sent / queued / recovered) refuses another click: it could only duplicate
// the message; the two adverse outcomes stay clickable — a retry is the next move.
export function ResendButton({ id, onResent, compact = false }: { id: string; onResent?: () => void; compact?: boolean }) {
  const t = useTranslations("channels.comms");
  // The outbox-row copy this button needs beyond the shared comms vocabulary.
  const td = useTranslations("devcase.outbox");
  // A dead letter is re-dispatched as it was: resend() with no corrected recipient.
  const { state, message, settled, adverse, resend } = useCommsResend(id, () => onResent?.());
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <button
        type="button"
        onClick={() => void resend()}
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
