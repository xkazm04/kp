"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "@/app/_components/toast-store";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import { resolveTimeZone, timeZoneShortLabel } from "@/app/_lib/timezone";

export type Invite = {
  candidateLabel?: string | null;
  jobTitle?: string | null;
  status: string;
  slot?: string | null;
  slotAt?: string | null;
  durationMin?: number | null;
  attendanceStatus?: string | null;
  meetingUrl?: string | null;
  // "Propose your own times" escalation state: 'pending' (waiting on the team) or
  // 'declined' (couldn't accommodate — they'll reach out). null when no escalation.
  proposalStatus?: string | null;
};
export type Slot = { value: string; label: string };

// Mirrors MAX_PROPOSALS on the server (schedule-slots.ts): the escalation form offers
// up to three time inputs. Kept as a literal so the client bundle doesn't import the
// better-sqlite3-adjacent module chain.
export const MAX_PROPOSE_TIMES = 3;

// idea-b51106df — the slots render in the candidate's BROWSER-local zone, but
// a shifted "16:00" reads as ambiguous without naming the zone. Derive a short
// zone label (e.g. "GMT+2") from any concrete instant on the page so the note
// can say "All times in your timezone (GMT+2)". Empty string degrades the note
// out (e.g. a runtime that can't resolve a zone), never showing "()".
export function useTzLabel(): (iso: string | null | undefined) => string {
  const locale = useLocale();
  return (iso: string | null | undefined): string => timeZoneShortLabel(iso, locale);
}

/** All of the candidate scheduling surface's state, loading and mutations for one
 *  invite token. The view components below it are presentational: every fetch, every
 *  refetch-after-action and every terminal-state latch lives here. */
export function useScheduleInvite(token: string) {
  const t = useTranslations("schedule");
  const errMsg = useErrorMessage();
  const [invite, setInvite] = useState<Invite | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  // Server-authoritative "the whole horizon is booked" signal (idea-5df8e10f) —
  // distinct from "not loaded yet". When true the recruiter has been flagged and
  // the candidate gets a defined outcome instead of a dead-end.
  const [noSlots, setNoSlots] = useState(false);
  // W1.4 honesty — were these times actually checked against the interviewer's calendar?
  // The server has always known (fetchBusy separates "checked, clear" from "we don't
  // know") and never told the candidate, so a time offered blind during a Google outage
  // looked identical to a confirmed-free one. One bit only: the candidate is never told
  // WHY the check didn't happen, nor anything about the interviewer's busy times.
  const [calendarChecked, setCalendarChecked] = useState(false);
  // Direction 1 — a dead-capability link: expired (aged out unbooked) or closed by
  // the state machine (declined / no_show). Renders a terminal card instead of a
  // picker that can never book.
  const [closedReason, setClosedReason] = useState<string | null>(null);
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
  // "Propose your own times" escalation (shown only in the two stuck states): the
  // candidate's proposal_status from the server, the datetime-local inputs, and a
  // submitting latch. `capReached` gates the escalation on the booked card.
  const [proposalStatus, setProposalStatus] = useState<string | null>(null);
  const [capReached, setCapReached] = useState(false);
  const [proposeTimes, setProposeTimes] = useState<string[]>(["", "", ""]);
  const [proposing, setProposing] = useState(false);

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
        setCalendarChecked(d.calendarChecked === true);
        setCanReschedule(Boolean(d.canReschedule));
        setCapReached(Boolean(d.rescheduleCapReached));
        setProposalStatus(d.invite?.proposalStatus ?? null);
        if (d.closed) setClosedReason(typeof d.closedReason === "string" ? d.closedReason : "closed");
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
                setCalendarChecked(nd.calendarChecked === true);
              }
            })
            // The booking itself succeeded — only the follow-up refresh failed, so
            // a toast (not the page-level error state) is the right weight.
            .catch(() => {
              toast.error(t("slotsRefreshFailed"));
            });
        }
      } else if (res.status === 410) {
        // The link went dead between load and submit (aged out / closed) — swap the
        // picker for the terminal card rather than leave a stale error over live slots.
        setClosedReason("closed");
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
                setCalendarChecked(nd.calendarChecked === true);
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
        setCalendarChecked(nd.calendarChecked === true);
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

  // Direction 1 — the candidate withdraws from the interview entirely (terminal
  // 'declined'). Distinct from the rsvp cancel that frees the slot for re-booking;
  // this closes the invite, and the terminal card takes over.
  const withdraw = async () => {
    setRsvpPending("cancel");
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/schedule/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ withdraw: true }),
      });
      const d = await res.json();
      if (!res.ok) {
        setError(errMsg(d, t("confirmFailed")));
        return;
      }
      setClosedReason("declined");
    } catch {
      setError(t("confirmFailed"));
    } finally {
      setRsvpPending(null);
    }
  };

  // "Propose your own times" escalation: the candidate names up to MAX_PROPOSE_TIMES
  // concrete times. Each datetime-local value is the candidate's browser-local wall
  // clock; sent as an ISO instant, the server validates it in the INTERVIEW zone
  // (weekday + working hours) and re-authors the label — arbitrary text never lands.
  const submitProposals = async () => {
    const isos = proposeTimes
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => {
        const d = new Date(s);
        return Number.isNaN(d.getTime()) ? null : d.toISOString();
      })
      .filter((v): v is string => v !== null);
    if (isos.length === 0) {
      setError(t("proposeEmpty"));
      return;
    }
    setProposing(true);
    setError(null);
    try {
      const res = await fetch(`/api/schedule/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propose: isos }),
      });
      const d = await res.json();
      if (!res.ok) {
        if (res.status === 410) setClosedReason("closed");
        else setError(errMsg(d, t("confirmFailed")));
        return;
      }
      setProposalStatus("pending");
    } catch {
      setError(t("confirmFailed"));
    } finally {
      setProposing(false);
    }
  };

  const setProposeTime = (idx: number, value: string) => {
    setProposeTimes((prev) => prev.map((p, i) => (i === idx ? value : p)));
  };

  // Entering / leaving reschedule mode always clears a stale error alongside the
  // flag — the two lines were inline on the buttons before the split.
  const startReschedule = () => {
    setError(null);
    setRescheduling(true);
  };
  const keepCurrentTime = () => {
    setError(null);
    setRescheduling(false);
  };

  return {
    invite,
    slots,
    noSlots,
    calendarChecked,
    closedReason,
    error,
    picking,
    confirmed,
    canReschedule,
    rescheduling,
    confirmationDelivery,
    rsvpPending,
    notice,
    proposalStatus,
    capReached,
    proposeTimes,
    proposing,
    pick,
    rsvp,
    withdraw,
    submitProposals,
    setProposeTime,
    startReschedule,
    keepCurrentTime,
  };
}
