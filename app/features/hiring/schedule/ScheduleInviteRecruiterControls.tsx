"use client";

// Direction 2 — the recruiter control cluster on a confirmed invite row:
// cancel (free the slot) and mark no-show, both two-step (armed → confirm) via
// the app's inline delete idiom. The recruiter-side reschedule picker was
// removed 2026-08-10 (operators no longer adjust event times — a time change
// happens through the candidate's self-scheduling link or their proposal,
// which the recruiter merely accepts). Split out of
// ScheduleInviteLifecyclePanel.tsx to keep the panel file under the 200-line cap.

import { Ban, UserX } from "lucide-react";
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
  return (
    <div className="mt-1 flex w-full flex-wrap items-center gap-1.5 border-t border-stone-100 pt-1.5">
      {isArmed && armed.action === "cancel" ? (
        <span className="inline-flex items-center gap-1.5" role="group" aria-label={t("cancelPrompt")}>
          <span className="text-micro font-semibold text-amber-800">{t("cancelPrompt")}</span>
          <button type="button" disabled={isBusy} onClick={() => runAction(i.token, "cancel")} className="focus-ring rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-micro font-semibold text-amber-800 hover:bg-amber-100 disabled:opacity-50">
            {t("confirmAction")}
          </button>
          <button type="button" autoFocus onClick={() => setArmed(null)} className="focus-ring rounded-md px-2 py-1 text-micro font-semibold text-steel hover:bg-stone-100">
            {t("cancel")}
          </button>
        </span>
      ) : isArmed && armed.action === "no_show" ? (
        <span className="inline-flex items-center gap-1.5" role="group" aria-label={t("noShowPrompt")}>
          <span className="text-micro font-semibold text-red-700">{t("noShowPrompt")}</span>
          <button type="button" disabled={isBusy} onClick={() => runAction(i.token, "no_show")} className="focus-ring rounded-md border border-red-300 bg-red-50 px-2 py-1 text-micro font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50">
            {t("confirmAction")}
          </button>
          <button type="button" autoFocus onClick={() => setArmed(null)} className="focus-ring rounded-md px-2 py-1 text-micro font-semibold text-steel hover:bg-stone-100">
            {t("cancel")}
          </button>
        </span>
      ) : (
        <>
          <button type="button" disabled={isBusy} onClick={() => setArmed({ token: i.token, action: "cancel" })} className="focus-ring inline-flex items-center gap-1 rounded-md border border-stone-200 px-2 py-1 text-micro font-semibold text-steel hover:border-coral/50 disabled:opacity-50">
            <Ban size={12} aria-hidden /> {t("cancelBooking")}
          </button>
          <button type="button" disabled={isBusy} onClick={() => setArmed({ token: i.token, action: "no_show" })} className="focus-ring inline-flex items-center gap-1 rounded-md border border-stone-200 px-2 py-1 text-micro font-semibold text-red-700 hover:border-red-300 hover:bg-red-50 disabled:opacity-50">
            <UserX size={12} aria-hidden /> {t("markNoShow")}
          </button>
        </>
      )}
    </div>
  );
}
