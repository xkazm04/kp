"use client";

import { useEffect, useState } from "react";
import { CalendarClock, CalendarPlus, Check } from "lucide-react";
import { useTranslations } from "next-intl";
import { buildIcs, downloadFile } from "@/app/_lib/export-utils";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import { useSlotLabel } from "@/app/_lib/use-slot-label";

type Invite = {
  candidateLabel?: string | null;
  jobTitle?: string | null;
  status: string;
  slot?: string | null;
  slotAt?: string | null;
  durationMin?: number | null;
};
type Slot = { value: string; label: string };

export function SchedulePicker({ token }: { token: string }) {
  const t = useTranslations("schedule");
  const tCommon = useTranslations("common");
  const errMsg = useErrorMessage();
  // SCH4 — display the slot in the candidate's locale from the ISO time the API
  // returns; the server-minted English label stays the fallback (and the stored
  // canonical value for the recruiter feed + emails).
  const slotLabel = useSlotLabel();
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
        body: JSON.stringify({ slot: s.label, slotAt: s.value, reschedule: isReschedule }),
      });
      const d = await res.json();
      if (res.ok) {
        setConfirmationSent(d.confirmationSent !== false);
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
            .catch(() => {});
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
            .catch(() => {});
        }
      }
    } catch {
      setError(t("confirmFailed"));
    } finally {
      setPicking(null);
    }
  };

  // Download the confirmed slot as an .ics the candidate imports into any calendar
  // (SCH1) — the top no-show cause is a time that never made it onto the calendar.
  const downloadInvite = () => {
    if (!invite?.slotAt) return;
    const ics = buildIcs({
      uid: `kp-interview-${token}`,
      start: invite.slotAt,
      durationMin: invite.durationMin ?? 30,
      title: invite.jobTitle ? t("icsTitleRole", { role: invite.jobTitle }) : t("icsTitle"),
      description: t("icsDescription"),
      stamp: new Date().toISOString(),
    });
    downloadFile("interview.ics", ics, "text/calendar");
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
          {confirmationSent ? t("confirmationSent") : t("confirmationUnsent")}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {invite.slotAt ? (
            <button
              type="button"
              onClick={downloadInvite}
              className="focus-ring inline-flex items-center gap-1.5 rounded-md border border-stone-300 bg-white px-3 py-1.5 text-base font-semibold text-ink hover:border-coral/50"
            >
              <CalendarPlus size={15} className="text-coral" /> {t("addToCalendar")}
            </button>
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
      </div>
    );
  }

  return (
    <div>
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
        <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
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
      )}
    </div>
  );
}
