"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import { isAdverseResend, resendOutcome, type ResendOutcomeKind } from "@/app/_lib/comms-resend-outcome";

export type ResendState = "idle" | "busy" | ResendOutcomeKind;

/**
 * One resend of one message through `POST /api/comms/[id]/resend`, and the honest sentence about
 * what it did. Lifted out of ChannelsCommsBouncedResend.tsx (which now renders over it) so the
 * Night Post's letter (night/message) offers the SAME door with the same five outcomes, read once
 * by `resendOutcome` (comms-resend-outcome.ts): refused (the reason resolved from the machine
 * `code`, never the server's English), recovered (a 409 that means "already being delivered":
 * calm, never red), dead-lettered again, queued (recorded, and nothing will deliver it) and sent
 * (the only one that may say "Resent").
 *
 * `resend(recipient)` posts a corrected address for a bounce; `resend()` re-dispatches a dead
 * letter as it was. Settled (sent / queued / recovered) refuses another click: it could only
 * duplicate the message. `reset()` returns an answered door to idle (the address was edited) but
 * never while a POST is in flight: clearing `busy` there re-enabled the button mid-request.
 */
export function useCommsResend(id: string, onResent: () => void) {
  const t = useTranslations("channels.comms");
  const errMsg = useErrorMessage();
  const [state, setState] = useState<ResendState>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const settled = state === "sent" || state === "queued" || state === "recovered";

  const resend = async (recipient?: string) => {
    if (state === "busy" || settled) return;
    setState("busy");
    setMessage(null);
    try {
      const r = await fetch(`/api/comms/${encodeURIComponent(id)}/resend`, {
        method: "POST",
        ...(recipient === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ recipient }) }),
      });
      const payload = await r.json().catch(() => null);
      const outcome = resendOutcome(r.ok, r.status, payload);
      setState(outcome.kind);
      switch (outcome.kind) {
        case "refused":
          setMessage(t("resendRejected", { reason: errMsg(outcome, t("resendFailed")) }));
          return;
        case "recovered":
          // The double-click case: the server collapsed the second POST because the first
          // one IS delivering. Calm, not red.
          setMessage(t("resendRecovered"));
          onResent();
          return;
        case "deadLettered":
          setMessage(outcome.detail ? `${t("resendDeadLettered")} ${t("failureDetail", { detail: outcome.detail })}` : t("resendDeadLettered"));
          onResent();
          return;
        case "queued":
          // Recorded, but NOTHING WILL DELIVER IT: `queued` is the terminal local-outbox
          // state reached when no relay is configured, and the relay can be gone by the time
          // a recruiter chases a letter raised while it was wired.
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

  const reset = () => {
    if (state !== "idle" && state !== "busy") setState("idle");
  };

  const adverse = state !== "idle" && state !== "busy" && isAdverseResend(state);
  return { state, message, settled, adverse, resend, reset };
}
