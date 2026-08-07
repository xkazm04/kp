"use client";

import { useEffect, useState } from "react";
import { CalendarClock, Check, Video } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "@/app/_components/toast-store";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import { useSlotLabel } from "@/app/_lib/use-slot-label";
import { resolveTimeZone, timeZoneShortLabel } from "@/app/_lib/timezone";
import { AddToCalendar } from "@/app/features/sub_schedule/AddToCalendar";

type Invite = {
  candidateLabel?: string | null;
  jobTitle?: string | null;
  status: string;
  slot?: string | null;
  slotAt?: string | null;
  durationMin?: number | null;
  attendanceStatus?: string | null;
  meetingUrl?: string | null;
};
type Slot = { value: string; label: string };

export function SchedulePicker({ token }: { token: string }) {
  const t = useTranslations("schedule");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const errMsg = useErrorMessage();
  // SCH4 — display the slot in the candidate's locale from the ISO time the API
  // returns; the server-minted English label stays the fallback (and the stored
  // canonical value for the recruiter feed + emails).
  const slotLabel = useSlotLabel();
  // idea-b51106df — the slots render in the candidate's BROWSER-local zone, but
  // a shifted "16:00" reads as ambiguous without naming the zone. Derive a short
  // zone label (e.g. "GMT+2") from any concrete instant on the page so the note
  // can say "All times in your timezone (GMT+2)". Empty string degrades the note
  // out (e.g. a runtime that can't resolve a zone), never showing "()".
  const tzLabel = (iso: string | null | undefined): string => timeZoneShortLabel(iso, locale);
  const [invite, setInvite] = useState<Invite | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  // Server-authoritative "the whole horizon is booked" signal (idea-5df8e10f) —
  // distinct from "not loaded yet". When true the recruiter has been flagged and
  // the candidate gets a defined outcome instead of a dead-end.
  const [noSlots, setNoSlots] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<string | null>(null);
  // The candidate may still self-reschedule a confirmed booking (server-gated by
  // MAX_RESCHEDULES). `rescheduling` swaps the booked card for the slot picker.
  const [canReschedule, setCanReschedule] = useState(false);
  const [rescheduling, setRescheduling] = useState(false);
  // REC-10 — the confirmation's TRUTHFUL delivery claim from the booking POST:
  // "sent" (relayed), "queued" (recorded in the local outbox, nothing delivers
  // it — so no email/reminder promise), "failed" (dispatch dead-lettered), or
  // null (a reloaded already-confirmed invite: delivery unknown, claim nothing).
  const [confirmationDelivery, setConfirmationDelivery] = useState<"sent" | "queued" | "failed" | null>(null);
  // RSVP on the confirmed booking (idea-87af39c5): which action is mid-flight, and
  // a transient notice after a cancel returns the candidate to the slot picker.
  const [rsvpPending, setRsvpPending] = useState<"confirm" | "cancel" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/schedule/${token}`)
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        if (d.error) {
          setError(t("linkInvalid"));
          return;
        }
        setInvite(d.invite);
        setSlots(d.slots ?? []);
        setNoSlots(Boolean(d.noSlots));
        setCanReschedule(Boolean(d.canReschedule));
        if (d.invite?.status === "confirmed") setConfirmed(d.invite.slot ?? "");
      })
      .catch(() => {
        if (alive) setError(t("loadFailed"));
      });
    return () => {
      alive = false;
    };
  }, [token, t]);

  const pick = async (s: Slot) => {
    setPicking(s.value);
    setError(null);
    const isReschedule = rescheduling;
    try {
      const res = await fetch(`/api/schedule/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slot: s.label, slotAt: s.value, reschedule: isReschedule, tz: resolveTimeZone() }),
      });
      const d = await res.json();
      if (res.ok) {
        const claim = d.confirmationDelivery;
        setConfirmationDelivery(
          claim === "sent" || claim === "queued" || claim === "failed"
            ? claim
            : d.confirmationSent !== false
              ? "sent"
              : "failed"
        );
        setConfirmed(s.label);
        // Adopt the server's confirmed invite (carries the ISO slotAt) so the
        // booked card's "Add to calendar" has a real datetime for a fresh booking.
        if (d.invite) setInvite(d.invite);
        if (isReschedule) {
          // Back to the booked card showing the new time; refresh the remaining
          // reschedule allowance + slot pool so the affordance disappears at the cap.
          setRescheduling(false);
          fetch(`/api/schedule/${token}`)
            .then((r) => r.json())
            .then((nd) => {
              if (!nd.error) {
                setCanReschedule(Boolean(nd.canReschedule));
                setSlots(nd.slots ?? []);
              }
            })
            // The booking itself succeeded — only the follow-up refresh failed, so
            // a toast (not the page-level error state) is the right weight.
            .catch(() => {
              toast.error(t("slotsRefreshFailed"));
            });
        }
      } else {
        setError(errMsg(d, t("confirmFailed")));
        // Slot taken by someone else between load and submit — refresh the list.
        if (res.status === 409) {
          fetch(`/api/schedule/${token}`)
            .then((r) => r.json())
            .then((nd) => {
              if (!nd.error) {
                setSlots(nd.slots ?? []);
                setNoSlots(Boolean(nd.noSlots));
              }
            })
            // The 409 error is already on screen; this only means the stale slot
            // list couldn't be refreshed — tell the candidate to reload.
            .catch(() => {
              toast.error(t("slotsRefreshFailed"));
            });
        }
      }
    } catch {
      setError(t("confirmFailed"));
    } finally {
      setPicking(null);
    }
  };

  // The confirmed booking as a calendar event (SCH1) — the top no-show cause is a
  // time that never made it onto the calendar. Localized content; when the recruiter
  // attached a join link it becomes the location + a "Join" line. Feeds the
  // Add-to-calendar menu (Google / Outlook / .ics) on the booked card.
  const calendarEvent = (() => {
    if (!invite?.slotAt) return null;
    const durMin = invite.durationMin ?? 30;
    const meetingUrl = invite.meetingUrl?.trim() || null;
    return {
      title: invite.jobTitle ? t("icsTitleRole", { role: invite.jobTitle }) : t("icsTitle"),
      start: invite.slotAt,
      end: new Date(new Date(invite.slotAt).getTime() + durMin * 60_000).toISOString(),
      description: meetingUrl ? `${t("icsDescription")}\n${t("joinInterview")}: ${meetingUrl}` : t("icsDescription"),
      location: meetingUrl ?? undefined,
    };
  })();

  // RSVP on the confirmed booking (idea-87af39c5). "I'll be there" stamps an
  // attendance signal the recruiter sees; "I can't make it" frees the slot and
  // drops the candidate back to the picker to choose a new time.
  const rsvp = async (action: "confirm" | "cancel") => {
    setRsvpPending(action);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/schedule/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rsvp: action }),
      });
      const d = await res.json();
      if (!res.ok) {
        setError(errMsg(d, t("confirmFailed")));
        return;
      }
      if (action === "confirm") {
        if (d.invite) setInvite(d.invite);
        return;
      }
      // Cancelled — the booking is released and the invite is pending again. Return
      // to the slot grid (confirmed → null) and refresh the offerable times.
      setConfirmed(null);
      setRescheduling(false);
      if (d.invite) setInvite(d.invite);
      setNotice(t("rsvpCancelledNote"));
      const nd = await fetch(`/api/schedule/${token}`)
        .then((r) => r.json())
        .catch(() => null);
      if (nd && !nd.error) {
        setSlots(nd.slots ?? []);
        setNoSlots(Boolean(nd.noSlots));
        setCanReschedule(Boolean(nd.canReschedule));
      } else {
        // The cancel went through (the notice above says so) but the fresh slot
        // pool didn't load — surface it instead of showing an empty grid silently.
        toast.error(t("slotsRefreshFailed"));
      }
    } catch {
      setError(t("confirmFailed"));
    } finally {
      setRsvpPending(null);
    }
  };

  if (error)
    return (
      <p role="alert" className="rounded-md border border-stone-200 bg-paper p-4 text-base text-coral">
        {error}
      </p>
    );
  if (!invite) return <p className="text-base text-steel">{tCommon("loading")}</p>;

  if (confirmed && !rescheduling) {
    return (
      // role="status" + aria-live so the booking confirmation is announced — the primary
      // action of the page previously swapped in visual-only, leaving SR users with no
      // signal that the slot was booked.
      <div role="status" aria-live="polite" className="rounded-lg border border-moss/40 bg-moss/5 p-5">
        <p className="flex items-center gap-2 font-serif text-h2 text-ink">
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
              onClick={() => {
                setError(null);
                setRescheduling(true);
              }}
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
                onClick={() => rsvp("confirm")}
                className="focus-ring inline-flex items-center gap-1.5 rounded-md bg-moss px-3 py-1.5 text-base font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                <Check size={15} aria-hidden /> {rsvpPending === "confirm" ? t("booking") : t("rsvpConfirm")}
              </button>
              <button
                type="button"
                disabled={rsvpPending !== null}
                onClick={() => rsvp("cancel")}
                className="focus-ring inline-flex items-center gap-1.5 rounded-md border border-stone-300 bg-white px-3 py-1.5 text-base font-semibold text-steel transition-colors hover:border-coral/50 disabled:opacity-50"
              >
                {rsvpPending === "cancel" ? t("booking") : t("rsvpCancel")}
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

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
                  slot: slotLabel(invite?.slotAt, confirmed),
                  b: (chunks) => <span className="font-medium text-ink">{chunks}</span>,
                })
              : t("reschedulePrompt")}
          </p>
          <button
            type="button"
            onClick={() => {
              setError(null);
              setRescheduling(false);
            }}
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
          <p className="mt-2 text-base text-steel">{t("nothingToDo")}</p>
        </div>
      ) : (
        <>
        {tzLabel(slots[0]?.value) ? (
          <p className="mt-3 text-meta text-steel">{t("timezoneNote", { zone: tzLabel(slots[0]?.value) })}</p>
        ) : null}
        <ul className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {slots.map((s) => (
            <li key={s.value}>
              <button
                type="button"
                disabled={picking !== null}
                onClick={() => pick(s)}
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
