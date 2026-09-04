"use client";

import { CalendarX } from "lucide-react";
import { useTranslations } from "next-intl";
import { SCHEDULE_FOCUS_ID } from "./schedule-focus";

// Direction 1 — dead-capability terminal card. `expired` (aged out unbooked) gets
// its own copy; a state-machine close (declined / no_show) shares the generic
// "no longer active" card. Mirrors the "all taken" terminal-card pattern.
export function DeadLinkCard({ closedReason }: { closedReason: string }) {
  const t = useTranslations("schedule");
  const isExpired = closedReason === "expired";
  return (
    <div role="status" className="rounded-lg border border-stone-200 bg-paper p-5">
      {/* The focus anchor for this surface (schedule-focus.ts): tabIndex={-1} makes the
          heading programmatically focusable without adding a tab stop, so the candidate
          whose link just died lands on the sentence that says so. */}
      <p id={SCHEDULE_FOCUS_ID.dead} tabIndex={-1} className="flex items-center gap-2 font-serif text-h2 text-ink">
        <CalendarX className="text-steel" aria-hidden /> {isExpired ? t("linkExpiredTitle") : t("linkClosedTitle")}
      </p>
      <p className="mt-2 text-body text-ink">{isExpired ? t("linkExpiredBody") : t("linkClosedBody")}</p>
      <p className="mt-2 text-base text-steel">{t("linkClosedHelp")}</p>
    </div>
  );
}
