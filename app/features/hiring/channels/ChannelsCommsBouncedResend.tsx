"use client";
/* eslint-disable i18next/no-literal-string -- prototype-stage copy; threaded into
   the channels.comms namespace on consolidation (matches the JD Ledger's own disable). */

// A bounced message is a `sent` row the relay later rejected — resending it to
// the SAME address just bounces again, so this control asks for a corrected
// email and posts it to the resend route. It's the in-app action a bounced row
// was missing. Split out of ChannelsCommsTable.tsx to keep the table file
// under the 200-line cap.

import { useState } from "react";
import { useTranslations } from "next-intl";
import { isDeliverableAddress } from "@/app/_lib/comms-recipient";
import { BTN_PRIMARY, FIELD, META_LABEL } from "@/app/_components/ui/recipes";

export function BouncedResend({ id, defaultRecipient, onResent }: { id: string; defaultRecipient: string | null; onResent: () => void }) {
  const t = useTranslations("channels.comms");
  const [recipient, setRecipient] = useState(defaultRecipient ?? "");
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const valid = isDeliverableAddress(recipient.trim());
  const resend = async () => {
    if (state === "busy" || state === "done" || !valid) return;
    setState("busy");
    try {
      const r = await fetch(`/api/comms/${encodeURIComponent(id)}/resend`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipient: recipient.trim() }),
      });
      if (!r.ok) throw new Error();
      setState("done");
      onResent();
    } catch {
      setState("error");
    }
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
            if (state !== "idle") setState("idle");
          }}
          placeholder={t("bouncedRecipientPlaceholder")}
          className={`${FIELD} w-full text-sm`}
        />
      </label>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-steel" role={state === "error" ? "alert" : undefined}>
          {state === "error" ? t("resendFailed") : recipient.trim() && !valid ? t("bouncedResendInvalid") : ""}
        </span>
        <button
          type="button"
          onClick={resend}
          disabled={!valid || state === "busy" || state === "done"}
          className={`${BTN_PRIMARY} h-8 px-3 text-sm`}
        >
          {state === "done" ? t("resent") : state === "busy" ? t("resending") : t("resend")}
        </button>
      </div>
    </div>
  );
}
