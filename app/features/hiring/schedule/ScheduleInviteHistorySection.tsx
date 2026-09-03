"use client";

// The "awaiting" (sent, not yet booked) and "closed" (declined/no_show/expired)
// collapsed history sections of InviteLifecyclePanel. Split out of
// ScheduleInviteLifecyclePanel.tsx to keep the panel file under the 200-line
// cap.

import { CalendarClock, CalendarX, Hourglass } from "lucide-react";
import type { useTranslations } from "next-intl";
import { canReinvite, closedReason } from "./scheduleInviteLifecycleBuckets";
import { CalendarEventChip } from "./ScheduleCalendarEventChip";
import type { ScheduleInvite } from "@/app/_lib/schedule-store";
import type { ArmedAction } from "./useScheduleInviteLifecycle";

export function AwaitingSection({
  awaiting,
  t,
  relayConfigured,
  relativeTime,
}: {
  awaiting: ScheduleInvite[];
  t: ReturnType<typeof useTranslations<"scheduleTab.lifecycle">>;
  relayConfigured: boolean | null;
  relativeTime: (iso: string) => string;
}) {
  if (awaiting.length === 0) return null;
  return (
    <details className="mt-3">
      <summary className="focus-ring flex cursor-pointer items-center gap-1.5 text-meta uppercase tracking-wide text-steel">
        <Hourglass size={13} aria-hidden /> {t("awaiting", { count: awaiting.length })}
      </summary>
      <ul className="mt-1.5 space-y-1">
        {awaiting.map((i) => (
          <li key={i.id} className="flex flex-wrap items-baseline gap-x-2 rounded-md border border-stone-100 bg-paper/40 px-3 py-1.5 text-sm">
            <span className="font-semibold text-ink">{i.candidateLabel ?? "—"}</span>
            {i.jobTitle ? <span className="text-steel">· {i.jobTitle}</span> : null}
            {/* idea-87af39c5 — a candidate who cancelled attendance is back here
                awaiting a new time; flag it so the recruiter can follow up. */}
            {i.attendanceStatus === "cancelled" ? (
              <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-meta normal-case text-amber-800">
                {t("attendanceCancelled")}
              </span>
            ) : null}
            {/* A cancelled booking's calendar entry: 'removed' is the quiet all-clear,
                'orphaned' is the one that still needs a human to delete it. */}
            <CalendarEventChip state={i.calendarEventState} link={i.calendarEventLink} t={t} />
            <span className="ml-auto text-micro text-steel">
              {t(relayConfigured === false ? "queuedAgo" : "sentAgo", { time: relativeTime(i.createdAt) })}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

export function ClosedSection({
  closed,
  loadedAt,
  t,
  slotLine,
  armed,
  setArmed,
  busy,
  reinvite,
}: {
  closed: ScheduleInvite[];
  loadedAt: number;
  t: ReturnType<typeof useTranslations<"scheduleTab.lifecycle">>;
  slotLine: (i: ScheduleInvite) => string;
  armed: ArmedAction | null;
  setArmed: (a: ArmedAction | null) => void;
  busy: string | null;
  reinvite: (token: string, entryId: string | null) => Promise<void>;
}) {
  if (closed.length === 0) return null;
  return (
    // Direction 1 — the terminal fates that used to vanish: an interview the
    // candidate declined, a no-show the recruiter marked, or a link that aged
    // out unbooked. Collapsed + low-emphasis (it's history, not an action
    // queue), but present so no interview silently disappears.
    <details className="mt-3">
      <summary className="focus-ring flex cursor-pointer items-center gap-1.5 text-meta uppercase tracking-wide text-steel">
        <CalendarX size={13} aria-hidden /> {t("closed", { count: closed.length })}
      </summary>
      <ul className="mt-1.5 space-y-1">
        {closed.map((i) => {
          const reason = closedReason(i, loadedAt) ?? "closed";
          return (
            <li key={i.id} className="flex flex-wrap items-baseline gap-x-2 rounded-md border border-stone-100 bg-paper/40 px-3 py-1.5 text-sm">
              <span className="font-semibold text-ink">{i.candidateLabel ?? "—"}</span>
              {i.jobTitle ? <span className="text-steel">· {i.jobTitle}</span> : null}
              {/* The booked time survives on a no_show so the recruiter sees which slot was missed. */}
              {reason === "no_show" && i.slotAt ? <span className="text-steel nums">· {slotLine(i)}</span> : null}
              <CalendarEventChip state={i.calendarEventState} link={i.calendarEventLink} t={t} />
              <span
                className={`ml-auto rounded-full px-1.5 py-0.5 text-meta normal-case ${
                  reason === "no_show"
                    ? "bg-red-100 text-red-700"
                    : reason === "declined"
                      ? "bg-amber-100 text-amber-800"
                      : "bg-stone-100 text-steel"
                }`}
              >
                {t(reason === "no_show" ? "closedNoShow" : reason === "declined" ? "closedDeclined" : "closedExpired")}
              </span>
              {/* Re-invite from Closed: mint a fresh link for a candidate whose
                  interview fell through — but never for a terminal (rejected/hired)
                  entry (canReinvite checks the linked entry like reminder eligibility
                  does). Two-step armed confirm, consistent with the panel's idiom. */}
              {canReinvite(i, loadedAt) ? (
                <span className="mt-1 flex w-full items-center gap-1.5 border-t border-stone-100 pt-1.5">
                  {armed?.token === i.token && armed.action === "reinvite" ? (
                    <span className="inline-flex items-center gap-1.5" role="group" aria-label={t("reinvitePrompt")}>
                      <span className="text-micro font-semibold text-ink">{t("reinvitePrompt")}</span>
                      <button type="button" disabled={busy === i.token} onClick={() => reinvite(i.token, i.entryId)} className="focus-ring rounded-md border border-moss/40 bg-moss/10 px-2 py-1 text-micro font-semibold text-moss hover:bg-moss/20 disabled:opacity-50">
                        {t("confirmAction")}
                      </button>
                      <button type="button" autoFocus onClick={() => setArmed(null)} className="focus-ring rounded-md px-2 py-1 text-micro font-semibold text-steel hover:bg-stone-100">
                        {t("cancel")}
                      </button>
                    </span>
                  ) : (
                    <button type="button" disabled={busy === i.token} onClick={() => setArmed({ token: i.token, action: "reinvite" })} className="focus-ring inline-flex items-center gap-1 rounded-md border border-stone-200 px-2 py-1 text-micro font-semibold text-ink hover:border-coral/50 disabled:opacity-50">
                      <CalendarClock size={12} aria-hidden /> {t("reinvite")}
                    </button>
                  )}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </details>
  );
}
