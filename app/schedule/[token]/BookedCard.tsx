"use client";

import type { ReactNode } from "react";
import { CalendarClock, Check, Video } from "lucide-react";
import { useTranslations } from "next-intl";
import { SCHEDULE_FOCUS_ID } from "./schedule-focus";
import { useSlotLabel } from "@/app/_lib/use-slot-label";
import { AddToCalendar } from "@/app/features/hiring/schedule/ScheduleAddToCalendar";
import { candidateCalendarEvent } from "@/app/_lib/calendar-links";
import type { Invite } from "./use-schedule-invite";
import { useTzLabel } from "./use-schedule-invite";
import { BTN_AFFIRM } from "@/app/_components/ui/recipes";

/** The confirmed-booking card: the slot, the delivery claim, the join / add-to-calendar
 *  / reschedule actions, the RSVP row and the withdraw exit. `proposeSection` is the
 *  already-built escalation element, rendered only once the reschedule cap is hit. */
export function BookedCard({
  invite,
  token,
  confirmed,
  confirmationDelivery,
  canReschedule,
  capReached,
  rsvpPending,
  onReschedule,
  onRsvp,
  onWithdraw,
  proposeSection,
}: {
  invite: Invite;
  token: string;
  confirmed: string;
  confirmationDelivery: "sent" | "queued" | "failed" | null;
  canReschedule: boolean;
  capReached: boolean;
  rsvpPending: "confirm" | "cancel" | null;
  onReschedule: () => void;
  onRsvp: (action: "confirm" | "cancel") => void;
  onWithdraw: () => void;
  proposeSection: ReactNode;
}) {
  const t = useTranslations("schedule");
  // SCH4 — display the slot in the candidate's locale from the ISO time the API
  // returns; the server-minted English label stays the fallback (and the stored
  // canonical value for the recruiter feed + emails).
  const slotLabel = useSlotLabel();
  const tzLabel = useTzLabel();

  // The confirmed booking as a calendar event (SCH1) — the top no-show cause is a
  // time that never made it onto the calendar. Localized content; when the recruiter
  // attached a join link it becomes the location + a "Join" line. Feeds the
  // Add-to-calendar menu (Google / Outlook / .ics) on the booked card.
  // bug-ui-scan-2026-07-09 (interview-scheduling-prep-rubric #5) — build the event
  // via the shared candidateCalendarEvent so the candidate and recruiter calendars
  // derive the SAME default duration (was an inline `?? 30` here vs 45 on the
  // recruiter side) and location fallback for one interview. Text stays localized.
  const calendarEvent = candidateCalendarEvent(
    { slotAt: invite.slotAt ?? null, durationMin: invite.durationMin ?? null, meetingUrl: invite.meetingUrl },
    {
      title: invite.jobTitle ? t("icsTitleRole", { role: invite.jobTitle }) : t("icsTitle"),
      description: t("icsDescription"),
      joinLabel: t("joinInterview"),
      locationOnline: t("icsLocationOnline"),
    }
  );

  return (
    // role="status" + aria-live so the booking confirmation is announced — the primary
    // action of the page previously swapped in visual-only, leaving SR users with no
    // signal that the slot was booked.
    <div role="status" aria-live="polite" className="rounded-lg border border-moss/40 bg-moss/5 p-5">
      {/* The focus anchor for this surface (schedule-focus.ts) — the primary action of
          the whole page ends here, so this is where focus goes when the picker swaps out. */}
      <p id={SCHEDULE_FOCUS_ID.booked} tabIndex={-1} className="flex items-center gap-2 font-serif text-h2 text-ink">
        <Check className="text-moss" aria-hidden /> {t("bookedTitle")}
      </p>
      <p className="mt-2 text-body text-ink">
        {invite.jobTitle
          ? t.rich("bookedForRole", {
              role: invite.jobTitle,
              slot: slotLabel(invite.slotAt, confirmed),
              b: (chunks) => <span className="font-semibold">{chunks}</span>,
            })
          : t.rich("bookedForGeneric", {
              slot: slotLabel(invite.slotAt, confirmed),
              b: (chunks) => <span className="font-semibold">{chunks}</span>,
            })}
      </p>
      <p className="mt-2 text-base text-steel">
        {invite.durationMin ? t("planFor", { min: invite.durationMin }) : ""}
        {confirmationDelivery === "sent"
          ? t("confirmationSent")
          : confirmationDelivery === "queued"
            ? t("confirmationQueued")
            : confirmationDelivery === "failed"
              ? t("confirmationUnsent")
              : ""}
      </p>
      {tzLabel(invite.slotAt) ? (
        <p className="mt-1 text-meta text-steel">{t("timezoneNote", { zone: tzLabel(invite.slotAt) })}</p>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        {invite.meetingUrl ? (
          <a
            href={invite.meetingUrl}
            target="_blank"
            rel="noreferrer"
            className="focus-ring inline-flex items-center gap-1.5 rounded-md bg-coral px-3 py-1.5 text-base font-semibold text-white transition-opacity hover:opacity-90"
          >
            <Video size={15} aria-hidden /> {t("joinInterview")}
          </a>
        ) : null}
        {calendarEvent ? (
          <AddToCalendar
            event={calendarEvent}
            uid={`kp-interview-${token}`}
            triggerClassName="focus-ring inline-flex items-center gap-1.5 rounded-md border border-stone-300 bg-white px-3 py-1.5 text-base font-semibold text-ink hover:border-coral/50"
          />
        ) : null}
        {canReschedule ? (
          <button
            type="button"
            onClick={onReschedule}
            className="focus-ring inline-flex items-center gap-1.5 rounded-md border border-stone-300 bg-white px-3 py-1.5 text-base font-semibold text-ink hover:border-coral/50"
          >
            <CalendarClock size={15} className="text-coral" /> {t("differentTime")}
          </button>
        ) : null}
      </div>
      {/* RSVP (idea-87af39c5): turn the one-way booking into a two-way confirm so
          the recruiter gets an early no-show signal and a freed slot. */}
      <div className="mt-3 border-t border-moss/20 pt-3">
        {invite.attendanceStatus === "confirmed" ? (
          <p className="flex items-center gap-1.5 text-base font-medium text-moss">
            <Check size={15} aria-hidden /> {t("attendanceConfirmed")}
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-base text-steel">{t("rsvpPrompt")}</span>
            <button
              type="button"
              disabled={rsvpPending !== null}
              onClick={() => onRsvp("confirm")}
              className={`${BTN_AFFIRM} px-3 py-1.5 text-base`}
            >
              <Check size={15} aria-hidden /> {rsvpPending === "confirm" ? t("booking") : t("rsvpConfirm")}
            </button>
            <button
              type="button"
              disabled={rsvpPending !== null}
              onClick={() => onRsvp("cancel")}
              className="focus-ring inline-flex items-center gap-1.5 rounded-md border border-stone-300 bg-white px-3 py-1.5 text-base font-semibold text-steel transition-colors hover:border-coral/50 disabled:opacity-50"
            >
              {rsvpPending === "cancel" ? t("booking") : t("rsvpCancel")}
            </button>
          </div>
        )}
        {/* Direction 1 — an honest terminal exit for a candidate who can't proceed
            at all, so the interview closes instead of the link living on forever. */}
        <button
          type="button"
          disabled={rsvpPending !== null}
          onClick={onWithdraw}
          className="focus-ring mt-2 inline-flex text-meta text-steel underline underline-offset-2 hover:text-coral disabled:opacity-50"
        >
          {t("withdraw")}
        </button>
      </div>
      {/* Reschedule cap hit: the "different time" affordance is gone, so instead of
          the old "reply to your confirmation email" dead-end, let the candidate
          propose concrete times the recruiter can accept. */}
      {capReached ? proposeSection : null}
    </div>
  );
}
