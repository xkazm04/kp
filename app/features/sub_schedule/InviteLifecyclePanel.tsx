"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CalendarClock, Hourglass } from "lucide-react";
import { useTranslations } from "next-intl";
import { useSlotLabel } from "@/app/_lib/use-slot-label";
import { useRelativeTime } from "@/app/features/sub_pipeline/PipelineShared";
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
  // SCH4 — render the booked slot in the recruiter's active locale via the
  // canonical hook (the picker already uses it), instead of a raw locale-less
  // toLocaleString() that also rendered "Invalid Date" on an unparsable slotAt.
  const slotLabel = useSlotLabel();
  const [invites, setInvites] = useState<ScheduleInvite[] | null>(null);
  // "Now" captured when the data landed, so the upcoming/past split is a pure
  // function of state during render (react-hooks/purity) — the agenda is as
  // fresh as the fetch, which is the honest claim anyway.
  const [loadedAt, setLoadedAt] = useState(0);
  const [failed, setFailed] = useState(false);

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

  const attention = invites.filter((i) => i.needsMoreSlots || i.needsReconcile);
  const upcoming = invites
    .filter((i) => i.status === "confirmed" && i.slotAt && Date.parse(i.slotAt) >= loadedAt && !attention.includes(i))
    .sort((a, b) => Date.parse(a.slotAt as string) - Date.parse(b.slotAt as string));
  const awaiting = invites.filter((i) => i.status !== "confirmed" && !attention.includes(i));

  if (attention.length === 0 && upcoming.length === 0 && awaiting.length === 0) return null;

  const slotLine = (i: ScheduleInvite) =>
    i.slotAt
      ? `${slotLabel(i.slotAt, i.slot)}${i.durationMin ? ` · ${i.durationMin} min` : ""}`
      : (i.slot ?? "—");

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
                <span className="text-red-700">
                  {i.needsMoreSlots ? t("needsMoreSlots") : t("needsReconcile", { reason: i.reconcileReason ?? "" })}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {upcoming.length > 0 ? (
        <div className="mt-3">
          <p className="text-meta uppercase tracking-wide text-steel">{t("upcoming", { count: upcoming.length })}</p>
          <ul className="mt-1.5 space-y-1">
            {upcoming.map((i) => (
              <li key={i.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded-md border border-stone-100 bg-paper/40 px-3 py-1.5 text-sm">
                <span className="font-semibold text-ink nums">{slotLine(i)}</span>
                <span className="text-ink">{i.candidateLabel ?? "—"}</span>
                {i.jobTitle ? <span className="text-steel">· {i.jobTitle}</span> : null}
                {/* idea-b51106df — the candidate's own timezone, so the recruiter
                    reads slotLine() (their local time) knowing where the candidate is. */}
                {i.candidateTz ? <span className="text-xs text-steel" title={i.candidateTz}>· {i.candidateTz}</span> : null}
                {i.rescheduleCount > 0 ? (
                  <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-800">
                    {t("rescheduled", { count: i.rescheduleCount })}
                  </span>
                ) : null}
                {/* idea-87af39c5 — the candidate's RSVP, an early no-show signal. */}
                {i.attendanceStatus === "confirmed" ? (
                  <span className="rounded-full bg-moss/15 px-1.5 py-0.5 text-xs font-semibold text-moss">
                    {t("attendanceConfirmed")}
                  </span>
                ) : null}
                <span className="ml-auto text-xs text-steel">
                  {i.reminderSentAt ? t("reminderSent") : t("reminderPending")}
                </span>
              </li>
            ))}
          </ul>
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
                <span className="ml-auto text-xs text-steel">{t("sentAgo", { time: relativeTime(i.createdAt) })}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
