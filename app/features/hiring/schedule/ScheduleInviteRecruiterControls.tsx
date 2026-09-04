"use client";

// Direction 2 — the recruiter control cluster on a confirmed invite row:
// cancel (free the slot) and mark no-show, both two-step (armed → confirm) via
// the app's inline delete idiom. The recruiter-side reschedule picker was
// removed 2026-08-10 (operators no longer adjust event times — a time change
// happens through the candidate's self-scheduling link or their proposal,
// which the recruiter merely accepts). Split out of
// ScheduleInviteLifecyclePanel.tsx to keep the panel file under the 200-line cap.

import { Ban, UserX } from "lucide-react";
import { BTN_GHOST, BTN_SECONDARY } from "@/app/_components/ui/recipes";
import type { useTranslations } from "next-intl";
import type { ScheduleInvite } from "@/app/_lib/schedule-store";
import type { ArmedAction } from "./useScheduleInviteLifecycle";

export function RecruiterControls({
  invite: i,
  t,
  armed,
  setArmed,
  busy,
  runAction,
}: {
  invite: ScheduleInvite;
  t: ReturnType<typeof useTranslations<"scheduleTab.lifecycle">>;
  armed: ArmedAction | null;
  setArmed: (a: ArmedAction | null) => void;
  busy: string | null;
  runAction: (token: string, action: string, slotAt?: string) => Promise<boolean>;
}) {
  const isBusy = busy === i.token;
  const isArmed = armed?.token === i.token;
  // Cancel and no-show are the two RECORD-WRITING actions here — each seals a decision,
  // frees (or spends) an interview slot and takes the calendar event down — and both
  // were disabled-only in flight: the label never changed and nothing was announced, so
  // a slow round-trip looked like a dead button and invited a second click on the other
  // one. The confirm button now states what it is doing and carries `aria-busy`, the
  // same shape the tab's Confirm/Start controls use.
  return (
    <div className="mt-1 flex w-full flex-wrap items-center gap-1.5 border-t border-stone-100 pt-1.5">
      {isArmed && armed.action === "cancel" ? (
        <span className="inline-flex items-center gap-1.5" role="group" aria-label={t("cancelPrompt")}>
          <span className="text-micro font-semibold text-amber-800">{t("cancelPrompt")}</span>
          <button type="button" disabled={isBusy} aria-busy={isBusy} onClick={() => runAction(i.token, "cancel")} className={`${BTN_SECONDARY} border-amber-300 bg-amber-50 px-2 py-1 text-micro font-semibold text-amber-800 hover:bg-amber-100`}>
            {isBusy ? t("cancelling") : t("confirmAction")}
          </button>
          <button type="button" autoFocus onClick={() => setArmed(null)} className={`${BTN_GHOST} px-2 py-1 text-micro font-semibold`}>
            {t("cancel")}
          </button>
        </span>
      ) : isArmed && armed.action === "no_show" ? (
        <span className="inline-flex items-center gap-1.5" role="group" aria-label={t("noShowPrompt")}>
          <span className="text-micro font-semibold text-red-700">{t("noShowPrompt")}</span>
          <button type="button" disabled={isBusy} aria-busy={isBusy} onClick={() => runAction(i.token, "no_show")} className={`${BTN_SECONDARY} border-red-300 bg-red-50 px-2 py-1 text-micro font-semibold text-red-700 hover:bg-red-100`}>
            {isBusy ? t("markingNoShow") : t("confirmAction")}
          </button>
          <button type="button" autoFocus onClick={() => setArmed(null)} className={`${BTN_GHOST} px-2 py-1 text-micro font-semibold`}>
            {t("cancel")}
          </button>
        </span>
      ) : (
        <>
          <button type="button" disabled={isBusy} aria-busy={isBusy} onClick={() => setArmed({ token: i.token, action: "cancel" })} className={`${BTN_SECONDARY} px-2 py-1 text-micro font-semibold text-steel hover:border-coral/50`}>
            <Ban size={12} aria-hidden /> {t("cancelBooking")}
          </button>
          <button type="button" disabled={isBusy} aria-busy={isBusy} onClick={() => setArmed({ token: i.token, action: "no_show" })} className={`${BTN_SECONDARY} px-2 py-1 text-micro font-semibold text-red-700 hover:border-red-300 hover:bg-red-50`}>
            <UserX size={12} aria-hidden /> {t("markNoShow")}
          </button>
        </>
      )}
    </div>
  );
}
