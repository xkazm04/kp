"use client";

import { CalendarClock } from "lucide-react";
import { useTranslations } from "next-intl";
import { MAX_PROPOSE_TIMES } from "./use-schedule-invite";

// The escalation surface, shared by the two stuck states (a fully-booked horizon and
// the reschedule cap). Shows the honest waiting / declined state once submitted, else
// the proposal form. Tokens only; verified in both themes.
export function ProposeSection({
  proposalStatus,
  proposeTimes,
  proposing,
  onChangeTime,
  onSubmit,
}: {
  proposalStatus: string | null;
  proposeTimes: string[];
  proposing: boolean;
  onChangeTime: (idx: number, value: string) => void;
  onSubmit: () => void;
}) {
  const t = useTranslations("schedule");

  if (proposalStatus === "pending") {
    return (
      <div role="status" className="mt-4 rounded-md border border-moss/40 bg-moss/5 p-4">
        <p className="flex items-center gap-2 font-medium text-ink">
          <CalendarClock size={16} className="text-moss" aria-hidden /> {t("proposalsPendingTitle")}
        </p>
        <p className="mt-1 text-base text-steel">{t("proposalsPendingBody")}</p>
      </div>
    );
  }
  if (proposalStatus === "declined") {
    return (
      <div role="status" className="mt-4 rounded-md border border-dial-amber/40 bg-dial-amber/10 p-4">
        <p className="font-medium text-ink">{t("proposalsDeclinedTitle")}</p>
        <p className="mt-1 text-base text-ink">{t("proposalsDeclinedBody")}</p>
      </div>
    );
  }
  return (
    <div className="mt-4 border-t border-stone-200 pt-4">
      <p className="font-serif text-h3 text-ink">{t("proposeTitle")}</p>
      <p className="mt-1 text-base text-steel">{t("proposeBody")}</p>
      <div className="mt-3 space-y-2">
        {Array.from({ length: MAX_PROPOSE_TIMES }).map((_, idx) => (
          <input
            key={idx}
            type="datetime-local"
            value={proposeTimes[idx] ?? ""}
            onChange={(e) => onChangeTime(idx, e.target.value)}
            aria-label={t("proposeSlotAria", { n: idx + 1 })}
            className="focus-ring w-full rounded-md border border-stone-200 bg-white px-3 py-2 text-base text-ink"
          />
        ))}
      </div>
      <button
        type="button"
        disabled={proposing}
        onClick={onSubmit}
        className="focus-ring mt-3 inline-flex items-center gap-1.5 rounded-md bg-coral px-3 py-1.5 text-base font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        <CalendarClock size={15} aria-hidden /> {proposing ? t("booking") : t("proposeSubmit")}
      </button>
    </div>
  );
}
