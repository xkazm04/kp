"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Ban, CalendarClock, CalendarX, Hourglass, UserX, Wrench } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "@/app/_components/toast-store";
import { useSlotLabel } from "@/app/_lib/use-slot-label";
import { publicBaseUrl } from "@/app/_lib/public-base-url";
import { interviewCalendarEvent } from "@/app/_lib/calendar-links";
import { useRelativeTime } from "@/app/features/sub_pipeline/PipelineShared";
import { useDeliveryCapability } from "@/app/features/useDeliveryCapability";
import { AddToCalendar } from "./AddToCalendar";
import { MeetingLinkCell } from "./MeetingLinkCell";
// bug-ui-scan-2026-07-09 (interview-scheduling-prep-rubric #3) — the today /
// upcoming / awaiting split lives in a pure, unit-tested module so a confirmed
// interview no longer vanishes the instant its start passes.
import { bucketInvites, closedReason, hasPendingProposals, isInProgress } from "./invite-lifecycle-buckets";
// The full invite wire row is single-sourced from the store (GET /api/schedule
// returns listScheduleInvites() unprojected). Type-only import, so schedule-store's
// better-sqlite3 runtime is NOT pulled into this client bundle. Replaces a lossy
// hand-copied 17-field mirror that already lagged the source.
import type { ScheduleInvite } from "@/app/_lib/schedule-store";

// W6-3 (SCH1) — the invite lifecycle, finally visible. Once a self-scheduling
// link was minted its whole life was invisible: no agenda of confirmed
// bookings, no view of sent-but-never-booked invites, and the operator flags
// the store deliberately persists "for the recruiter" — needs_more_slots
// (candidate hit a fully-booked horizon) and needs_reconcile (booked but the
// pipeline didn't advance) — terminated in a server console. Attention rows
// first; then the chronological agenda; then invites still awaiting a booking.
export function InviteLifecyclePanel() {
  const t = useTranslations("scheduleTab.lifecycle");
  const relativeTime = useRelativeTime();
  // REC-10 — with no delivery relay, "invite/reminder sent" chips must read as
  // the queued outbox rows they really are.
  const relayConfigured = useDeliveryCapability();
  // SCH4 — render the booked slot in the recruiter's active locale via the
  // canonical hook (the picker already uses it), instead of a raw locale-less
  // toLocaleString() that also rendered "Invalid Date" on an unparsable slotAt.
  const slotLabel = useSlotLabel();
  // App origin → a clickable reschedule link inside the calendar event body.
  const base = publicBaseUrl(typeof window !== "undefined" ? window.location.origin : "");
  const [invites, setInvites] = useState<ScheduleInvite[] | null>(null);
  // "Now" captured when the data landed, so the upcoming/past split is a pure
  // function of state during render (react-hooks/purity) — the agenda is as
  // fresh as the fetch, which is the honest claim anyway.
  const [loadedAt, setLoadedAt] = useState(0);
  const [failed, setFailed] = useState(false);
  // Direction 2 — recruiter-side invite control. `armed` is the two-step inline
  // confirm latch (token+action) reused from the app's delete idiom; `busy` gates a
  // row while its action is in flight; the reschedule sub-flow loads this team's
  // offered slots lazily and lets the recruiter pick one.
  const [armed, setArmed] = useState<{ token: string; action: "cancel" | "no_show" | "resolve_reconcile" | "decline_proposals" } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [rescheduleToken, setRescheduleToken] = useState<string | null>(null);
  const [rescheduleSlots, setRescheduleSlots] = useState<{ value: string; label: string }[] | null>(null);
  // Patch one invite in place (e.g. after a meeting link save) so the row + its
  // calendar event refresh without a full refetch.
  const updateInvite = (token: string, patch: Partial<ScheduleInvite>) =>
    setInvites((prev) => prev?.map((i) => (i.token === token ? { ...i, ...patch } : i)) ?? prev);

  // Run a recruiter action against an invite, then adopt the server's returned row so
  // it re-buckets in place (a cancel drops it to awaiting, a no-show to closed, a
  // reschedule updates the slot, a resolve clears the flag) without a full refetch.
  const runAction = async (token: string, action: string, slotAt?: string) => {
    setBusy(token);
    try {
      const r = await fetch("/api/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, action, slotAt }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        toast.error(typeof d.error === "string" ? d.error : t("actionFailed"));
        return false;
      }
      if (d.invite) updateInvite(token, d.invite as ScheduleInvite);
      return true;
    } catch {
      toast.error(t("actionFailed"));
      return false;
    } finally {
      setBusy(null);
      setArmed(null);
    }
  };

  // Open the reschedule sub-flow for a confirmed row: lazily load this team's offered
  // slots (the same collision-aware mechanism the candidate picker uses).
  const openReschedule = async (token: string) => {
    setRescheduleToken(token);
    setRescheduleSlots(null);
    try {
      const r = await fetch("/api/schedule?slots=1");
      const d = await r.json();
      setRescheduleSlots(Array.isArray(d.slots) ? d.slots : []);
    } catch {
      setRescheduleSlots([]);
      toast.error(t("actionFailed"));
    }
  };

  useEffect(() => {
    let alive = true;
    fetch("/api/schedule")
      .then((r) => {
        if (!r.ok) throw new Error();
        return r.json();
      })
      .then((p) => {
        if (!alive) return;
        setInvites((p.invites as ScheduleInvite[]) ?? []);
        setLoadedAt(Date.now());
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  if (failed) {
    return <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{t("loadFailed")}</p>;
  }
  if (invites === null) {
    return <div role="status" aria-label={t("loading")} className="h-16 animate-pulse rounded-lg bg-stone-100" />;
  }
  if (invites.length === 0) return null;

  // bug-ui-scan-2026-07-09 (interview-scheduling-prep-rubric #3) — pure bucketing:
  // adds a "today / in-progress / recent" bucket so a confirmed interview stays on
  // the panel through its start time and immediate aftermath instead of disappearing.
  const { attention, upcoming, today, awaiting, closed } = bucketInvites(invites, loadedAt);

  if (
    attention.length === 0 &&
    upcoming.length === 0 &&
    today.length === 0 &&
    awaiting.length === 0 &&
    closed.length === 0
  )
    return null;

  const slotLine = (i: ScheduleInvite) =>
    i.slotAt
      ? `${slotLabel(i.slotAt, i.slot)}${i.durationMin ? ` · ${i.durationMin} min` : ""}`
      : (i.slot ?? "—");

  // Direction 2 — the recruiter control cluster on a confirmed row: reschedule
  // (re-offer from this team's offered slots), cancel (free the slot), and mark
  // no-show. Cancel/no-show are two-step (armed → confirm) via the app's inline
  // delete idiom; reschedule swaps in a lazily-loaded offered-slot picker.
  const recruiterControls = (i: ScheduleInvite) => {
    const isBusy = busy === i.token;
    if (rescheduleToken === i.token) {
      return (
        <div className="mt-1 flex w-full flex-wrap items-center gap-1.5 border-t border-stone-100 pt-1.5" role="group" aria-label={t("rescheduleGroupAria")}>
          <span className="text-meta uppercase tracking-wide text-steel">{t("rescheduleTo")}</span>
          {rescheduleSlots === null ? (
            <span className="text-xs text-steel">{t("loading")}</span>
          ) : rescheduleSlots.length === 0 ? (
            <span className="text-xs text-steel">{t("noRescheduleSlots")}</span>
          ) : (
            rescheduleSlots.map((s) => (
              <button
                key={s.value}
                type="button"
                disabled={isBusy}
                onClick={async () => {
                  const ok = await runAction(i.token, "reschedule", s.value);
                  if (ok) {
                    setRescheduleToken(null);
                    setRescheduleSlots(null);
                  }
                }}
                className="focus-ring rounded-md border border-stone-200 px-2 py-1 text-xs font-semibold text-ink hover:border-coral/50 disabled:opacity-50"
              >
                {slotLabel(s.value, s.label)}
              </button>
            ))
          )}
          <button
            type="button"
            onClick={() => {
              setRescheduleToken(null);
              setRescheduleSlots(null);
            }}
            className="focus-ring ml-auto rounded-md px-2 py-1 text-xs font-semibold text-steel hover:text-ink"
          >
            {t("cancel")}
          </button>
        </div>
      );
    }
    const isArmed = armed?.token === i.token;
    return (
      <div className="mt-1 flex w-full flex-wrap items-center gap-1.5 border-t border-stone-100 pt-1.5">
        {isArmed && armed.action === "cancel" ? (
          <span className="inline-flex items-center gap-1.5" role="group" aria-label={t("cancelPrompt")}>
            <span className="text-micro font-semibold text-amber-800">{t("cancelPrompt")}</span>
            <button type="button" disabled={isBusy} onClick={() => runAction(i.token, "cancel")} className="focus-ring rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-micro font-semibold text-amber-800 hover:bg-amber-100 disabled:opacity-50">
              {t("confirmAction")}
            </button>
            <button type="button" autoFocus onClick={() => setArmed(null)} className="focus-ring rounded-md px-2 py-1 text-micro font-semibold text-steel hover:bg-stone-100">
              {t("cancel")}
            </button>
          </span>
        ) : isArmed && armed.action === "no_show" ? (
          <span className="inline-flex items-center gap-1.5" role="group" aria-label={t("noShowPrompt")}>
            <span className="text-micro font-semibold text-red-700">{t("noShowPrompt")}</span>
            <button type="button" disabled={isBusy} onClick={() => runAction(i.token, "no_show")} className="focus-ring rounded-md border border-red-300 bg-red-50 px-2 py-1 text-micro font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50">
              {t("confirmAction")}
            </button>
            <button type="button" autoFocus onClick={() => setArmed(null)} className="focus-ring rounded-md px-2 py-1 text-micro font-semibold text-steel hover:bg-stone-100">
              {t("cancel")}
            </button>
          </span>
        ) : (
          <>
            <button type="button" disabled={isBusy} onClick={() => openReschedule(i.token)} className="focus-ring inline-flex items-center gap-1 rounded-md border border-stone-200 px-2 py-1 text-micro font-semibold text-ink hover:border-coral/50 disabled:opacity-50">
              <CalendarClock size={12} aria-hidden /> {t("reschedule")}
            </button>
            <button type="button" disabled={isBusy} onClick={() => setArmed({ token: i.token, action: "cancel" })} className="focus-ring inline-flex items-center gap-1 rounded-md border border-stone-200 px-2 py-1 text-micro font-semibold text-steel hover:border-coral/50 disabled:opacity-50">
              <Ban size={12} aria-hidden /> {t("cancelBooking")}
            </button>
            <button type="button" disabled={isBusy} onClick={() => setArmed({ token: i.token, action: "no_show" })} className="focus-ring inline-flex items-center gap-1 rounded-md border border-stone-200 px-2 py-1 text-micro font-semibold text-red-700 hover:border-red-300 hover:bg-red-50 disabled:opacity-50">
              <UserX size={12} aria-hidden /> {t("markNoShow")}
            </button>
          </>
        )}
      </div>
    );
  };

  // One agenda row, shared by the "today" and "upcoming" lists so they can't drift.
  // `inProgress` adds a live chip on a call happening right now.
  const agendaRow = (i: ScheduleInvite, inProgress = false) => (
    <li key={i.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded-md border border-stone-100 bg-paper/40 px-3 py-1.5 text-sm">
      <span className="font-semibold text-ink nums">{slotLine(i)}</span>
      <span className="text-ink">{i.candidateLabel ?? "—"}</span>
      {i.jobTitle ? <span className="text-steel">· {i.jobTitle}</span> : null}
      {/* idea-b51106df — the candidate's own timezone, so the recruiter
          reads slotLine() (their local time) knowing where the candidate is. */}
      {i.candidateTz ? <span className="text-xs text-steel" title={i.candidateTz}>· {i.candidateTz}</span> : null}
      {inProgress ? (
        <span className="rounded-full bg-coral/15 px-1.5 py-0.5 text-xs font-semibold text-coral">{t("inProgress")}</span>
      ) : null}
      {i.rescheduleCount > 0 ? (
        <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-800">
          {t("rescheduled", { count: i.rescheduleCount })}
        </span>
      ) : null}
      {/* idea-87af39c5 — the candidate's RSVP, an early no-show signal. */}
      {i.attendanceStatus === "confirmed" ? (
        <span className="rounded-full bg-moss/15 px-1.5 py-0.5 text-xs font-semibold text-moss">{t("attendanceConfirmed")}</span>
      ) : null}
      <span className="ml-auto flex items-center gap-2">
        <span className="text-xs text-steel">
          {i.reminderSentAt ? t(relayConfigured === false ? "reminderQueued" : "reminderSent") : t("reminderPending")}
        </span>
        <MeetingLinkCell token={i.token} url={i.meetingUrl} onSaved={(url) => updateInvite(i.token, { meetingUrl: url })} />
        {(() => {
          const ev = interviewCalendarEvent(i, { baseUrl: base, meetingUrl: i.meetingUrl });
          return ev ? <AddToCalendar event={ev} uid={`interview-${i.token}`} /> : null;
        })()}
      </span>
      {recruiterControls(i)}
    </li>
  );

  return (
    <section className="rounded-lg border border-stone-200 bg-white p-4 shadow-panel">
      <h3 className="flex items-center gap-2 font-serif text-h3 text-ink">
        <CalendarClock size={16} className="text-coral" aria-hidden /> {t("title")}
      </h3>

      {attention.length > 0 ? (
        <div className="mt-2">
          <p className="flex items-center gap-1.5 text-meta uppercase tracking-wide text-red-700">
            <AlertTriangle size={13} aria-hidden /> {t("attention", { count: attention.length })}
          </p>
          <ul className="mt-1.5 space-y-1">
            {attention.map((i) => (
              <li key={i.id} className="rounded-md border border-red-200 bg-red-50/60 px-3 py-1.5 text-sm">
                <span className="font-semibold text-ink">{i.candidateLabel ?? "—"}</span>
                {i.jobTitle ? <span className="text-steel"> · {i.jobTitle}</span> : null}{" "}
                {hasPendingProposals(i) ? (
                  // "Propose your own times" escalation: the candidate suggested times;
                  // accept one (books via the collision-checked path) or decline all
                  // (returns an honest "couldn't accommodate" state to the candidate).
                  <>
                    <span className="text-red-700">{t("proposedTimes")}</span>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5" role="group" aria-label={t("proposalsGroupAria")}>
                      {(i.proposals ?? []).map((p) => (
                        <button
                          key={p.value}
                          type="button"
                          disabled={busy === i.token}
                          onClick={() => runAction(i.token, "accept_proposal", p.value)}
                          className="focus-ring rounded-md border border-moss/40 bg-moss/10 px-2 py-1 text-micro font-semibold text-moss hover:bg-moss/20 disabled:opacity-50"
                        >
                          {t("acceptProposal", { time: slotLabel(p.value, p.label) })}
                        </button>
                      ))}
                      {armed?.token === i.token && armed.action === "decline_proposals" ? (
                        <span className="inline-flex items-center gap-1.5" role="group" aria-label={t("declineProposalsPrompt")}>
                          <span className="text-micro font-semibold text-red-700">{t("declineProposalsPrompt")}</span>
                          <button type="button" disabled={busy === i.token} onClick={() => runAction(i.token, "decline_proposals")} className="focus-ring rounded-md border border-red-300 bg-white px-2 py-1 text-micro font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50">
                            {t("confirmAction")}
                          </button>
                          <button type="button" autoFocus onClick={() => setArmed(null)} className="focus-ring rounded-md px-2 py-1 text-micro font-semibold text-steel hover:bg-stone-100">
                            {t("cancel")}
                          </button>
                        </span>
                      ) : (
                        <button type="button" disabled={busy === i.token} onClick={() => setArmed({ token: i.token, action: "decline_proposals" })} className="focus-ring rounded-md border border-stone-200 px-2 py-1 text-micro font-semibold text-steel hover:border-red-300 hover:bg-red-50 disabled:opacity-50">
                          {t("declineProposals")}
                        </button>
                      )}
                    </div>
                  </>
                ) : (
                <span className="text-red-700">
                  {i.needsMoreSlots ? t("needsMoreSlots") : t("needsReconcile", { reason: i.reconcileReason ?? "" })}
                </span>
                )}
                {/* Direction 2 — in-app repair for the drift the store surfaces but
                    the recruiter previously could only read: resolve clears the flag
                    (two-step) once the mismatch is handled. */}
                {i.needsReconcile && !hasPendingProposals(i) ? (
                  <span className="mt-1 flex items-center gap-1.5">
                    {armed?.token === i.token && armed.action === "resolve_reconcile" ? (
                      <span className="inline-flex items-center gap-1.5" role="group" aria-label={t("resolvePrompt")}>
                        <span className="text-micro font-semibold text-red-700">{t("resolvePrompt")}</span>
                        <button type="button" disabled={busy === i.token} onClick={() => runAction(i.token, "resolve_reconcile")} className="focus-ring rounded-md border border-red-300 bg-white px-2 py-1 text-micro font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50">
                          {t("confirmAction")}
                        </button>
                        <button type="button" autoFocus onClick={() => setArmed(null)} className="focus-ring rounded-md px-2 py-1 text-micro font-semibold text-steel hover:bg-stone-100">
                          {t("cancel")}
                        </button>
                      </span>
                    ) : (
                      <button type="button" disabled={busy === i.token} onClick={() => setArmed({ token: i.token, action: "resolve_reconcile" })} className="focus-ring inline-flex items-center gap-1 rounded-md border border-red-200 bg-white px-2 py-1 text-micro font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50">
                        <Wrench size={12} aria-hidden /> {t("resolveReconcile")}
                      </button>
                    )}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* bug-ui-scan-2026-07-09 (interview-scheduling-prep-rubric #3) — the in-
          progress / just-finished bucket that used to vanish; shown first as the
          most time-sensitive (a call happening now, or one needing a no-show call). */}
      {today.length > 0 ? (
        <div className="mt-3">
          <p className="text-meta uppercase tracking-wide text-steel">{t("today", { count: today.length })}</p>
          <ul className="mt-1.5 space-y-1">{today.map((i) => agendaRow(i, isInProgress(i.slotAt, i.durationMin, loadedAt)))}</ul>
        </div>
      ) : null}

      {upcoming.length > 0 ? (
        <div className="mt-3">
          <p className="text-meta uppercase tracking-wide text-steel">{t("upcoming", { count: upcoming.length })}</p>
          <ul className="mt-1.5 space-y-1">{upcoming.map((i) => agendaRow(i))}</ul>
        </div>
      ) : null}

      {awaiting.length > 0 ? (
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
                  <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-800">
                    {t("attendanceCancelled")}
                  </span>
                ) : null}
                <span className="ml-auto text-xs text-steel">
                  {t(relayConfigured === false ? "queuedAgo" : "sentAgo", { time: relativeTime(i.createdAt) })}
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {/* Direction 1 — the terminal fates that used to vanish: an interview the
          candidate declined, a no-show the recruiter marked, or a link that aged
          out unbooked. Collapsed + low-emphasis (it's history, not an action
          queue), but present so no interview silently disappears. */}
      {closed.length > 0 ? (
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
                  <span
                    className={`ml-auto rounded-full px-1.5 py-0.5 text-xs font-semibold ${
                      reason === "no_show"
                        ? "bg-red-100 text-red-700"
                        : reason === "declined"
                          ? "bg-amber-100 text-amber-800"
                          : "bg-stone-100 text-steel"
                    }`}
                  >
                    {t(reason === "no_show" ? "closedNoShow" : reason === "declined" ? "closedDeclined" : "closedExpired")}
                  </span>
                </li>
              );
            })}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
