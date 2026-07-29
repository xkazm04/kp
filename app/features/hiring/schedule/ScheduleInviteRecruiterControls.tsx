"use client";

// Direction 2 — the recruiter control cluster on a confirmed invite row:
// reschedule (re-offer from this team's offered slots), cancel (free the
// slot), and mark no-show. Cancel/no-show are two-step (armed → confirm) via
// the app's inline delete idiom; reschedule swaps in a lazily-loaded
// offered-slot picker. Split out of ScheduleInviteLifecyclePanel.tsx to keep
// the panel file under the 200-line cap.

import { Ban, CalendarClock, UserX } from "lucide-react";
import type { useTranslations } from "next-intl";
import type { ScheduleInvite } from "@/app/_lib/schedule-store";
import type { ArmedAction } from "./useScheduleInviteLifecycle";

export function RecruiterControls({
  invite: i,
  t,
  slotLabel,
  armed,
  setArmed,
  busy,
  runAction,
  rescheduleToken,
  rescheduleSlots,
  openReschedule,
  setRescheduleToken,
  setRescheduleSlots,
}: {
  invite: ScheduleInvite;
  t: ReturnType<typeof useTranslations<"scheduleTab.lifecycle">>;
  slotLabel: (slotAt: string | null, slot?: string | null) => string;
  armed: ArmedAction | null;
  setArmed: (a: ArmedAction | null) => void;
  busy: string | null;
  runAction: (token: string, action: string, slotAt?: string) => Promise<boolean>;
  rescheduleToken: string | null;
  rescheduleSlots: { value: string; label: string }[] | null;
  openReschedule: (token: string) => void;
  setRescheduleToken: (token: string | null) => void;
  setRescheduleSlots: (slots: { value: string; label: string }[] | null) => void;
}) {
  const isBusy = busy === i.token;
  if (rescheduleToken === i.token) {
    return (
      <div className="mt-1 flex w-full flex-wrap items-center gap-1.5 border-t border-stone-100 pt-1.5" role="group" aria-label={t("rescheduleGroupAria")}>
        <span className="text-meta uppercase tracking-wide text-steel">{t("rescheduleTo")}</span>
        {rescheduleSlots === null ? (
          <span className="text-xs text-steel">{t("loading")}</span>
        ) : rescheduleSlots.length === 0 ? (
          <span className="text-xs text-steel">{t("noRescheduleSlots")}</span>
        ) : (
          rescheduleSlots.map((s) => (
            <button
              key={s.value}
              type="button"
              disabled={isBusy}
              onClick={async () => {
                const ok = await runAction(i.token, "reschedule", s.value);
                if (ok) {
                  setRescheduleToken(null);
                  setRescheduleSlots(null);
                }
              }}
              className="focus-ring rounded-md border border-stone-200 px-2 py-1 text-xs font-semibold text-ink hover:border-coral/50 disabled:opacity-50"
            >
              {slotLabel(s.value, s.label)}
            </button>
          ))
        )}
        <button
          type="button"
          onClick={() => {
            setRescheduleToken(null);
            setRescheduleSlots(null);
          }}
          className="focus-ring ml-auto rounded-md px-2 py-1 text-xs font-semibold text-steel hover:text-ink"
        >
          {t("cancel")}
        </button>
      </div>
    );
  }
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
          <button type="button" disabled={isBusy} onClick={() => openReschedule(i.token)} className="focus-ring inline-flex items-center gap-1 rounded-md border border-stone-200 px-2 py-1 text-micro font-semibold text-ink hover:border-coral/50 disabled:opacity-50">
            <CalendarClock size={12} aria-hidden /> {t("reschedule")}
          </button>
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
