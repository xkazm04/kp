"use client";

// A bounced message is a `sent` row the relay later rejected — resending it to
// the SAME address just bounces again, so this control asks for a corrected
// email and posts it to the resend route. It's the in-app action a bounced row
// was missing. Split out of ChannelsCommsTable.tsx to keep the table file
// under the 200-line cap.

import { useState } from "react";
import { useTranslations } from "next-intl";
import { isDeliverableAddress } from "@/app/_lib/comms-recipient";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import { isAdverseResend, resendOutcome, type ResendOutcomeKind } from "@/app/_lib/comms-resend-outcome";
import { BTN_PRIMARY, FIELD, META_LABEL } from "@/app/_components/ui/recipes";

export function BouncedResend({ id, defaultRecipient, onResent }: { id: string; defaultRecipient: string | null; onResent: () => void }) {
  const t = useTranslations("channels.comms");
  // Refusal reasons resolve from the machine `code`, never the server's English
  // `error` — see app/_lib/use-error-message.ts.
  const errMsg = useErrorMessage();
  const [recipient, setRecipient] = useState(defaultRecipient ?? "");
  const [state, setState] = useState<"idle" | "busy" | ResendOutcomeKind>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const valid = isDeliverableAddress(recipient.trim());
  // Settled: the message is out or on its way, so another click could only duplicate
  // it. The five outcomes themselves are derived once, in comms-resend-outcome.ts —
  // this fold used to be a verbatim copy of ResendButton's, and both were blind to the
  // recovered one (a 409 that means "already being delivered", painted red).
  const settled = state === "sent" || state === "queued" || state === "recovered";
  const resend = async () => {
    if (state === "busy" || settled || !valid) return;
    setState("busy");
    setMessage(null);
    try {
      const r = await fetch(`/api/comms/${encodeURIComponent(id)}/resend`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipient: recipient.trim() }),
      });
      const payload = await r.json().catch(() => null);
      const outcome = resendOutcome(r.ok, r.status, payload);
      setState(outcome.kind);
      switch (outcome.kind) {
        case "refused":
          setMessage(t("resendRejected", { reason: errMsg(outcome, t("resendFailed")) }));
          return;
        case "recovered":
          // The double-click case this control makes easy: the server collapsed the
          // second POST because the first one IS delivering. Calm, not red.
          setMessage(t("resendRecovered"));
          onResent();
          return;
        case "deadLettered":
          setMessage(outcome.detail ? `${t("resendDeadLettered")} ${t("failureDetail", { detail: outcome.detail })}` : t("resendDeadLettered"));
          onResent();
          return;
        case "queued":
          // Recorded, but NOTHING WILL DELIVER IT — `queued` is the terminal
          // local-outbox state reached when no relay is configured, and the relay can
          // be gone by the time a recruiter chases a bounce raised while it was wired.
          setMessage(t("relayNotConfigured"));
          onResent();
          return;
        default:
          onResent();
      }
    } catch {
      setMessage(t("resendFailed"));
      setState("refused");
    }
  };
  const adverse = state !== "idle" && state !== "busy" && isAdverseResend(state);
  return (
    <div className="space-y-2 rounded-md border border-red-200 bg-red-50/60 p-3">
      <p className="text-xs text-red-800">{t("bouncedResendHint")}</p>
      <label className="block">
        <span className={`mb-1 block ${META_LABEL}`}>{t("bouncedRecipientLabel")}</span>
        <input
          type="email"
          value={recipient}
          onChange={(e) => {
            setRecipient(e.target.value);
            // NOT while the POST is in flight: clearing `busy` here re-enabled the
            // button mid-request, so editing the address and clicking again fired a
            // second resend. The server collapses it (resendInFlight → 409 with
            // `recovered`), which now reads as "already being delivered" rather than
            // as a failure over a resend that had in fact gone out.
            if (state !== "idle" && state !== "busy") setState("idle");
          }}
          placeholder={t("bouncedRecipientPlaceholder")}
          className={`${FIELD} w-full text-sm`}
        />
      </label>
      <div className="flex items-center justify-between gap-2">
        <span className={`text-xs ${adverse ? "text-red-800" : "text-steel"}`} role={message ? "alert" : undefined}>
          {message ?? (recipient.trim() && !valid ? t("bouncedResendInvalid") : "")}
        </span>
        <button
          type="button"
          onClick={resend}
          disabled={!valid || state === "busy" || settled}
          className={`${BTN_PRIMARY} h-8 px-3 text-sm`}
        >
          {state === "sent"
            ? t("resent")
            : state === "recovered"
              ? t("statusRecovered")
              : state === "queued"
                ? t("statusQueued")
                : state === "busy"
                  ? t("resending")
                  : t("resend")}
        </button>
      </div>
    </div>
  );
}
