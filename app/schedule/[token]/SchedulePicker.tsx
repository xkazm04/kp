"use client";

import { useEffect, useState } from "react";
import { Check } from "lucide-react";

type Invite = { candidateLabel?: string | null; jobTitle?: string | null; status: string; slot?: string | null };
type Slot = { value: string; label: string };

export function SchedulePicker({ token }: { token: string }) {
  const [invite, setInvite] = useState<Invite | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<string | null>(null);

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
    try {
      const res = await fetch(`/api/schedule/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slot: s.label, slotAt: s.value }),
      });
      const d = await res.json();
      if (res.ok) {
        setConfirmed(s.label);
      } else {
        setError(d.error || "Couldn't confirm that slot.");
        // Slot taken by someone else between load and submit — refresh the list.
        if (res.status === 409) {
          fetch(`/api/schedule/${token}`)
            .then((r) => r.json())
            .then((nd) => {
              if (!nd.error) setSlots(nd.slots ?? []);
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

  if (error) return <p className="rounded-md border border-stone-200 bg-paper p-4 text-base text-coral">{error}</p>;
  if (!invite) return <p className="text-base text-steel">Loading…</p>;

  if (confirmed) {
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
          We&apos;ve sent a confirmation and will remind you before the call. You can close this page.
        </p>
      </div>
    );
  }

  return (
    <div>
      {invite.jobTitle ? (
        <p className="text-base text-steel">
          Role: <span className="font-medium text-ink">{invite.jobTitle}</span>
        </p>
      ) : null}
      {slots.length === 0 ? (
        <p className="mt-3 text-base text-steel">No slots are available right now — we&apos;ll be in touch.</p>
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
