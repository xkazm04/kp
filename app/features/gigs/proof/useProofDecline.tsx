"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { useTranslations } from "next-intl";
import { useErrorMessage, type ApiErrorPayload } from "@/app/_lib/use-error-message";
import type { Gig } from "@/app/_lib/gigs/types";
import { useBareKeys } from "../data/useBareKeys";
import { sendJson } from "../data/useGigsData";
import { afterLeavingList, type ListPosition } from "../logic/front";
import { canTransitionGig } from "@/app/_lib/gigs/transitions";
import { canQuickDecline } from "../logic/line";
import type { AfterWrite } from "../logic/wire";

// A proof's keys and its quick exits: Esc goes back, ← / → walk the list (no wrap), D asks
// to decline, and D again or Enter confirms (Esc cancels). "Withdraw for this" on a brief
// challenge is one click and names the reason (withdraw-reasons.ts). A gig that left the
// list either way moves the page to its neighbour and says so.

export function useProofDecline({
  gig,
  pos,
  onBack,
  onStep,
  onChanged,
  onLeft,
}: {
  gig: Gig | null;
  pos: ListPosition | null;
  onBack: () => void;
  onStep: (gigId: string) => void;
  onChanged: AfterWrite;
  onLeft: (next: string | null, message: string) => void;
}) {
  const t = useTranslations("gigs");
  const resolveError = useErrorMessage();
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  const declineRef = useRef<HTMLButtonElement | null>(null);
  const canDecline = gig !== null && canQuickDecline(gig.status);
  const [confirming, setConfirming] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [declineError, setDeclineError] = useState<string | null>(null);
  useEffect(() => {
    if (confirming) confirmRef.current?.focus();
  }, [confirming]);
  const cancelConfirm = () => {
    setConfirming(false);
    window.requestAnimationFrame(() => declineRef.current?.focus());
  };
  async function decline() {
    if (!gig || declining) return;
    setDeclining(true);
    setDeclineError(null);
    const res = await sendJson(`/api/gigs/${encodeURIComponent(gig.id)}`, "PATCH", { action: "decline" });
    setDeclining(false);
    if (!res.ok) {
      setDeclineError(resolveError(res.body as ApiErrorPayload | null, t("work.actionFailed")));
      return;
    }
    setConfirming(false);
    const title = gig.title;
    await onChanged(null);
    onLeft(afterLeavingList(pos), t("detail.declinedFlash", { title }));
  }
  // One click, no confirm: the operator picked the reason, which is the confirmation.
  const [withdrawing, setWithdrawing] = useState<number | null>(null);
  async function withdrawFor(index: number, challenge: string) {
    if (!gig || withdrawing !== null || declining) return;
    setWithdrawing(index);
    setDeclineError(null);
    const res = await sendJson(`/api/gigs/${encodeURIComponent(gig.id)}`, "PATCH", { action: "withdraw", challenge: index });
    setWithdrawing(null);
    if (!res.ok) {
      setDeclineError(resolveError(res.body as ApiErrorPayload | null, t("work.actionFailed")));
      return;
    }
    const title = gig.title;
    await onChanged(null);
    onLeft(afterLeavingList(pos), t("detail.withdrawnForFlash", { title, reason: challenge }));
  }
  const canWithdraw = gig !== null && canTransitionGig(gig.status, "withdrawn");

  const askDecline = () => {
    setDeclineError(null);
    setConfirming(true);
  };

  useBareKeys((key) => {
    if (declining) return key === "d" || key === "enter";
    if (confirming) {
      if (key === "escape") {
        cancelConfirm();
        return true;
      }
      if (key === "d") {
        void decline();
        return true;
      }
      if (key === "enter") {
        const active = document.activeElement;
        if (active && active !== document.body && active.closest("button, a, input, select, textarea, [role='button']")) return false;
        void decline();
        return true;
      }
    }
    if (key === "escape") {
      onBack();
      return true;
    }
    if (key === "arrowleft" && pos?.prev) {
      onStep(pos.prev);
      return true;
    }
    if (key === "arrowright" && pos?.next) {
      onStep(pos.next);
      return true;
    }
    if (key === "d" && canDecline && !confirming) {
      askDecline();
      return true;
    }
    return false;
  });

  return { canDecline, confirming, declining, declineError, askDecline, cancelConfirm, decline, confirmRef, declineRef, canWithdraw, withdrawing, withdrawFor };
}

/** The question D opens, under the trail. */
export function DeclineConfirm({ title, declining, confirmRef, onConfirm, onCancel }: { title: string; declining: boolean; confirmRef: RefObject<HTMLButtonElement | null>; onConfirm: () => void; onCancel: () => void }) {
  const t = useTranslations("gigs");
  return (
    <div className="confirm" role="group" aria-labelledby="gd-decline-q">
      <span id="gd-decline-q">{t.rich("detail.declineConfirm", { title, kbd: (c) => <kbd>{c}</kbd> })}</span>
      <span className="row-form">
        <button ref={confirmRef} type="button" className="btn quiet danger" disabled={declining} onClick={onConfirm}>
          {declining ? t("detail.declining") : t("detail.declineYes")}
        </button>
        <button type="button" className="btn quiet ghost" disabled={declining} onClick={onCancel}>
          {t("detail.declineNo")}
        </button>
      </span>
    </div>
  );
}
