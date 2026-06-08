"use client";

import { useEffect, useState } from "react";
import { CalendarClock, Check } from "lucide-react";

type Invite = {
  candidateLabel?: string | null;
  jobTitle?: string | null;
  status: string;
  slot?: string | null;
  durationMin?: number | null;
};
type Slot = { value: string; label: string };

export function SchedulePicker({ token }: { token: string }) {
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
  // False when the server booked the slot but the confirmation email failed to
  // send — the success card then softens its promise instead of lying.
  const [confirmationSent, setConfirmationSent] = useState(true);

  useEffect(() => {
    let alive = true;
    fetch(`/api/schedule/${token}`)
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        if (d.error) {
          setError("This scheduling link is no longer valid.");
          return;
        }
        setInvite(d.invite);
        setSlots(d.slots ?? []);
        setNoSlots(Boolean(d.noSlots));
        setCanReschedule(Boolean(d.canReschedule));
        if (d.invite?.status === "confirmed") setConfirmed(d.invite.slot ?? "");
      })
      .catch(() => {
        if (alive) setError("Couldn't load this page.");
      });
    return () => {
      alive = false;
    };
  }, [token]);

  const pick = async (s: Slot) => {
    setPicking(s.value);
    setError(null);
    const isReschedule = rescheduling;
    try {
      const res = await fetch(`/api/schedule/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slot: s.label, slotAt: s.value, reschedule: isReschedule }),
      });
      const d = await res.json();
      if (res.ok) {
        setConfirmationSent(d.confirmationSent !== false);
        setConfirmed(s.label);
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
            .catch(() => {});
        }
      } else {
        setError(d.error || "Couldn't confirm that slot.");
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
            .catch(() => {});
        }
      }
    } catch {
      setError("Couldn't confirm that slot.");
    } finally {
      setPicking(null);
    }
  };

  if (error)
    return (
      <p role="alert" className="rounded-md border border-stone-200 bg-paper p-4 text-base text-coral">
        {error}
      </p>
    );
  if (!invite) return <p className="text-base text-steel">Loading…</p>;

  if (confirmed && !rescheduling) {
    return (
      <div className="rounded-lg border border-moss/40 bg-moss/5 p-5">
        <p className="flex items-center gap-2 font-serif text-h2 text-ink">
          <Check className="text-moss" /> You&apos;re booked
        </p>
        <p className="mt-2 text-body text-ink">
          Your interview{invite.jobTitle ? ` for ${invite.jobTitle}` : ""} is confirmed for{" "}
          <span className="font-semibold">{confirmed}</span>.
        </p>
        <p className="mt-2 text-base text-steel">
          {invite.durationMin ? `Plan for about ${invite.durationMin} minutes. ` : ""}
          {confirmationSent
            ? "We've sent a confirmation and will remind you before the call. You can close this page."
            : "We've recorded your slot — we'll be in touch shortly to confirm the details. You can close this page."}
        </p>
        {canReschedule ? (
          <button
            type="button"
            onClick={() => {
              setError(null);
              setRescheduling(true);
            }}
            className="focus-ring mt-3 inline-flex items-center gap-1.5 rounded-md border border-stone-300 bg-white px-3 py-1.5 text-base font-semibold text-ink hover:border-coral/50"
          >
            <CalendarClock size={15} className="text-coral" /> Need a different time?
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div>
      {rescheduling ? (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-base text-steel">
            Pick a new time{confirmed ? <> — your current slot is <span className="font-medium text-ink">{confirmed}</span></> : null}.
          </p>
          <button
            type="button"
            onClick={() => {
              setError(null);
              setRescheduling(false);
            }}
            className="focus-ring rounded-md px-2 py-1 text-base font-semibold text-steel hover:text-ink"
          >
            Keep current time
          </button>
        </div>
      ) : null}
      {invite.jobTitle ? (
        <p className="text-base text-steel">
          Role: <span className="font-medium text-ink">{invite.jobTitle}</span>
          {invite.durationMin ? <span className="ml-2 text-steel">· ~{invite.durationMin} min</span> : null}
        </p>
      ) : null}
      {noSlots ? (
        <div role="status" className="mt-3 rounded-lg border border-stone-200 bg-paper p-5">
          <p className="flex items-center gap-2 font-serif text-h2 text-ink">
            <CalendarClock className="text-steel" /> All current times are taken
          </p>
          <p className="mt-2 text-body text-ink">
            Every interview slot in the next few weeks is already booked. We&apos;ve let the hiring team know you still
            need a time — they&apos;ll open more and email you a fresh scheduling link.
          </p>
          <p className="mt-2 text-base text-steel">Nothing to do right now — you can close this page.</p>
        </div>
      ) : (
        <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {slots.map((s) => (
            <li key={s.value}>
              <button
                type="button"
                disabled={picking !== null}
                onClick={() => pick(s)}
                className="focus-ring w-full rounded-md border border-stone-200 bg-white px-4 py-3 text-left text-base font-medium text-ink hover:border-coral/50 hover:bg-coral/5 disabled:opacity-50"
              >
                {picking === s.value ? "Booking…" : s.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
