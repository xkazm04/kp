"use client";

// A bounced message is a `sent` row the relay later rejected — resending it to
// the SAME address just bounces again, so this control asks for a corrected
// email and posts it to the resend route. It's the in-app action a bounced row
// was missing. Split out of ChannelsCommsTable.tsx to keep the table file
// under the 200-line cap. The resend itself (the POST, its five outcomes, the
// coded refusal) is useCommsResend, which the Night Post's letter shares.

import { useState } from "react";
import { useTranslations } from "next-intl";
import { isDeliverableAddress } from "@/app/_lib/comms-recipient";
import { BTN_PRIMARY, FIELD, META_LABEL } from "@/app/_components/ui/recipes";
import { useCommsResend } from "./useCommsResend";

export function BouncedResend({ id, defaultRecipient, onResent }: { id: string; defaultRecipient: string | null; onResent: () => void }) {
  const t = useTranslations("channels.comms");
  const [recipient, setRecipient] = useState(defaultRecipient ?? "");
  const { state, message, settled, adverse, resend: send, reset } = useCommsResend(id, onResent);
  const valid = isDeliverableAddress(recipient.trim());
  const resend = () => {
    if (valid) void send(recipient.trim());
  };
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
            reset();
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
