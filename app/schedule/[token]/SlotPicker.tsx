"use client";

import type { ReactNode } from "react";
import { CalendarClock } from "lucide-react";
import { useTranslations } from "next-intl";
import { useSlotLabel } from "@/app/_lib/use-slot-label";
import type { Invite, Slot } from "./use-schedule-invite";
import { useTzLabel } from "./use-schedule-invite";

/** The slot grid — the non-terminal state. Also carries the post-cancel notice, the
 *  reschedule header and the "no offerable times" card, because all three are the same
 *  screen from the candidate's side. */
export function SlotPicker({
  invite,
  slots,
  noSlots,
  calendarChecked,
  notice,
  rescheduling,
  confirmed,
  picking,
  onPick,
  onKeepCurrentTime,
  proposeSection,
}: {
  invite: Invite;
  slots: Slot[];
  noSlots: boolean;
  calendarChecked: boolean;
  notice: string | null;
  rescheduling: boolean;
  confirmed: string | null;
  picking: string | null;
  onPick: (s: Slot) => void;
  onKeepCurrentTime: () => void;
  proposeSection: ReactNode;
}) {
  const t = useTranslations("schedule");
  // SCH4 — display the slot in the candidate's locale from the ISO time the API
  // returns; the server-minted English label stays the fallback (and the stored
  // canonical value for the recruiter feed + emails).
  const slotLabel = useSlotLabel();
  const tzLabel = useTzLabel();

  return (
    <div>
      {notice ? (
        <p role="status" className="mb-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-base text-amber-800">
          {notice}
        </p>
      ) : null}
      {rescheduling ? (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-base text-steel">
            {confirmed
              ? t.rich("reschedulePromptCurrent", {
                  slot: slotLabel(invite.slotAt, confirmed),
                  b: (chunks) => <span className="font-medium text-ink">{chunks}</span>,
                })
              : t("reschedulePrompt")}
          </p>
          <button
            type="button"
            onClick={onKeepCurrentTime}
            className="focus-ring rounded-md px-2 py-1 text-base font-semibold text-steel hover:text-ink"
          >
            {t("keepCurrentTime")}
          </button>
        </div>
      ) : null}
      {invite.jobTitle ? (
        <p className="text-base text-steel">
          {t.rich("role", {
            role: invite.jobTitle,
            b: (chunks) => <span className="font-medium text-ink">{chunks}</span>,
          })}
          {invite.durationMin ? (
            <span className="ml-2 text-steel">{t("roleMinutes", { min: invite.durationMin })}</span>
          ) : null}
        </p>
      ) : null}
      {noSlots || slots.length === 0 ? (
        // `noSlots` is hard-coded false for a confirmed invite, so a RESCHEDULE into a
        // fully-booked horizon (slots === []) used to fall through to an empty grid with no
        // message. Showing this card whenever there are zero offerable slots covers both the
        // first-booking and reschedule cases (the "Keep current time" button above remains
        // the recovery in reschedule mode).
        <div role="status" className="mt-3 rounded-lg border border-stone-200 bg-paper p-5">
          <p className="flex items-center gap-2 font-serif text-h2 text-ink">
            <CalendarClock className="text-steel" aria-hidden /> {t("allTakenTitle")}
          </p>
          <p className="mt-2 text-body text-ink">{t("allTakenBody")}</p>
          {/* A pending invite whose whole horizon is booked (server-set `noSlots`) is a
              genuine dead-end — offer the "propose your own times" escalation. A
              reschedule-into-a-full-horizon (noSlots false) keeps the "Keep current
              time" recovery above, so it only needs the passive "nothing to do" note. */}
          {noSlots ? proposeSection : <p className="mt-2 text-base text-steel">{t("nothingToDo")}</p>}
        </div>
      ) : (
        <>
        {tzLabel(slots[0]?.value) ? (
          <p className="mt-3 text-meta text-steel">{t("timezoneNote", { zone: tzLabel(slots[0]?.value) })}</p>
        ) : null}
        {/* Honest about the calendar behind these times: confirmed-free, or offered
            without a check. Never the reason for the miss and never a busy count —
            that is the interviewer's calendar, not the candidate's business. */}
        <p className="mt-1 text-meta text-steel">
          {calendarChecked ? t("calendarCheckedNote") : t("calendarUncheckedNote")}
        </p>
        <ul className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {slots.map((s) => (
            <li key={s.value}>
              <button
                type="button"
                disabled={picking !== null}
                onClick={() => onPick(s)}
                className="focus-ring w-full rounded-md border border-stone-200 bg-white px-4 py-3 text-left text-base font-medium text-ink hover:border-coral/50 hover:bg-coral/5 disabled:opacity-50"
              >
                {picking === s.value ? t("booking") : slotLabel(s.value, s.label)}
              </button>
            </li>
          ))}
        </ul>
        </>
      )}
    </div>
  );
}
