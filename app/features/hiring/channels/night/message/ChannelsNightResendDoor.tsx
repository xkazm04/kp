"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button, TextField } from "@/app/_components/kit";
import { isDeliverableAddress } from "@/app/_lib/comms-recipient";
import { useCommsResend, type ResendState } from "../../useCommsResend";

/** The button's word for each state of the one resend: only a real `sent` says "Resent". */
function useResendLabel() {
  const t = useTranslations("channels.comms");
  const td = useTranslations("devcase.outbox");
  return (state: ResendState, adverse: boolean, idle: string) =>
    state === "sent" ? t("resent") : state === "recovered" ? t("statusRecovered") : state === "queued" ? t("statusQueued") : adverse ? td("retryResend") : idle;
}

function Outcome({ message, adverse }: { message: string | null; adverse: boolean }) {
  // A polite region is always in the tree, so a good answer is announced when it arrives (a live region
  // must exist first). An adverse one (refused, failed, bounced again) mounts as an alert with its words
  // in it, which is announced on insertion; the keys keep React from re-roling the same node.
  if (adverse && message) {
    return (
      <p key="alert" className="cn-door__said" data-adverse="1" role="alert">
        {message}
      </p>
    );
  }
  return (
    <p key="status" className="cn-door__said" role="status">
      {message}
    </p>
  );
}

/**
 * The letter's doors, the product's own (resendDoorOf decides which one a letter offers; the
 * resend and its five outcomes are useCommsResend, shared with the pipeline drawer's and the
 * outbox's BouncedResend). A dead letter re-dispatches as it was; a bounce asks for a corrected
 * address first (the same one bounces again). A refusal reads the reason from its `code` in the
 * reader's language; "Resent" only when the relay took it; `queued` says nothing will deliver it.
 */
export function RetryDoor({ id, onResent }: { id: string; onResent: () => void }) {
  const t = useTranslations("channels.comms");
  const tm = useTranslations("channelsNight.message.act");
  const label = useResendLabel();
  const { state, message, settled, adverse, resend } = useCommsResend(id, onResent);
  return (
    <div className="cn-door">
      <div className="cn-door__row">
        <Button
          variant="primary"
          icon="resend"
          label={label(state, adverse, t("resend"))}
          loading={state === "busy"}
          loadingLabel={t("resending")}
          disabled={settled}
          onClick={() => void resend()}
          data-level-key="door"
        />
      </div>
      <p className="cn-door__help">{tm("retryHelp")}</p>
      <Outcome message={message} adverse={adverse} />
    </div>
  );
}

export function CorrectAddressDoor({ id, defaultRecipient, onResent }: { id: string; defaultRecipient: string | null; onResent: () => void }) {
  const t = useTranslations("channels.comms");
  const tm = useTranslations("channelsNight.message.act");
  const label = useResendLabel();
  const [recipient, setRecipient] = useState(defaultRecipient ?? "");
  const { state, message, settled, adverse, resend, reset } = useCommsResend(id, onResent);
  const value = recipient.trim();
  const valid = isDeliverableAddress(value);
  return (
    <form
      className="cn-door"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) void resend(value);
      }}
    >
      <p className="cn-door__help">{t("bouncedResendHint")}</p>
      <label className="cn-door__field">
        <span>{t("bouncedRecipientLabel")}</span>
        <TextField
          label={t("bouncedRecipientLabel")}
          value={recipient}
          placeholder={t("bouncedRecipientPlaceholder")}
          invalid={Boolean(value) && !valid}
          onChange={(next) => {
            setRecipient(next);
            reset();
          }}
        />
      </label>
      {value && !valid ? <p className="cn-door__said" data-adverse="1">{t("bouncedResendInvalid")}</p> : null}
      <div className="cn-door__row">
        <Button
          type="submit"
          variant="primary"
          icon="resend"
          label={label(state, adverse, tm("correctSubmit"))}
          loading={state === "busy"}
          loadingLabel={t("resending")}
          disabled={!valid || settled}
          data-level-key="door"
        />
      </div>
      <Outcome message={message} adverse={adverse} />
    </form>
  );
}
