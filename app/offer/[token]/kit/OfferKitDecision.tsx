"use client";

import { useRef } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Button, LetterActs, Note, Outcome } from "@/app/_components/kit";
import { useDialogA11y } from "@/app/_components/useDialogA11y";
import { formatOfferDeadline } from "../offer-deadline";
import { offerKitDeadline, type OfferKitInput } from "./offerKitModel";

export type OfferKitDecisionProps = {
  responseError: string | null;
  pending: "accept" | "decline" | null;
  confirmingDecline: boolean;
  onAccept: () => void;
  onAskDecline: () => void;
  onCancelDecline: () => void;
  onConfirmDecline: () => void;
};

/**
 * The open offer's decision, on kit parts: the prompt, the deadline (coral inside 48h), a POST
 * failure as a critical note that keeps the buttons, then Accept / Decline, or the decline confirm.
 * The guards are OfferClient's: `pending` disables both buttons while one answer is in flight.
 */
export function OfferKitDecision(
  p: OfferKitDecisionProps & { offer: OfferKitInput & { timeZone: string }; company: string | null },
) {
  const t = useTranslations("offer");
  const locale = useLocale();
  const deadline = offerKitDeadline(p.offer);
  // The company's zone projected by the server, never the candidate's browser zone.
  const date = deadline ? formatOfferDeadline(p.offer.expiresAt, locale, p.offer.timeZone) : "";
  return (
    <>
      <p className="k-letter__line">{p.company ? t("prompt", { company: p.company }) : t("promptGeneric")}</p>
      {deadline && date ? (
        <p className={`k-letter__line${deadline.urgent ? " is-needs" : ""}`}>
          {t("deadline", { date })}{" "}
          {deadline.unit === "minutes" ? t("deadlineMinutes", { minutes: deadline.minutes }) : t("deadlineHours", { hours: deadline.hours })}
        </p>
      ) : null}
      {p.responseError ? <Note tone="critical">{p.responseError}</Note> : null}
      {p.confirmingDecline ? (
        <OfferKitDeclineConfirm
          busy={p.pending !== null}
          pending={p.pending === "decline"}
          onCancel={p.onCancelDecline}
          onConfirm={p.onConfirmDecline}
        />
      ) : (
        <LetterActs>
          <Button
            label={p.pending === "accept" ? t("recording") : t("accept")}
            variant="affirm"
            size="lg"
            icon={p.pending === "accept" ? undefined : "check"}
            data-sim-click="offer-accept"
            disabled={p.pending !== null}
            aria-busy={p.pending === "accept"}
            onClick={p.onAccept}
          />
          <Button label={t("decline")} variant="secondary" size="lg" disabled={p.pending !== null} onClick={p.onAskDecline} />
        </LetterActs>
      )}
    </>
  );
}

/**
 * The decline confirm (declining is irreversible): a real modal alertdialog on the shared hook, as
 * in OfferClient's DeclineConfirm. Focus moves in, Tab is trapped, Escape cancels (never mid-write),
 * focus returns to the trigger; "Go back" is FIRST in the DOM so the hook lands a keyboard user on
 * the safe option and the destructive button sits last.
 */
function OfferKitDeclineConfirm({
  busy, pending, onCancel, onConfirm,
}: { busy: boolean; pending: boolean; onCancel: () => void; onConfirm: () => void }) {
  const t = useTranslations("offer");
  const ref = useRef<HTMLDivElement>(null);
  useDialogA11y(ref, () => {
    if (!busy) onCancel();
  });
  return (
    <Outcome
      ref={ref}
      tabIndex={-1}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="decline-confirm-title"
      aria-describedby="decline-confirm-desc"
      titleId="decline-confirm-title"
      bodyId="decline-confirm-desc"
      title={t("declineConfirmTitle")}
      actions={
        <>
          <Button label={t("goBack")} variant="ghost" size="lg" disabled={busy} onClick={onCancel} />
          <Button
            label={pending ? t("recording") : t("confirm")}
            variant="danger"
            size="lg"
            data-sim-click="offer-decline-confirm"
            disabled={busy}
            aria-busy={pending}
            onClick={onConfirm}
          />
        </>
      }
    >
      {t("declineConfirmBody")}
    </Outcome>
  );
}
