"use client";

// All state, fetch/poll logic and recruiter actions for InviteLifecyclePanel,
// split out of ScheduleInviteLifecyclePanel.tsx so the component file stays
// under the 200-line cap. Returns everything the panel and its section
// components need; no JSX here.

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "@/app/_components/toast-store";
import { useSlotLabel } from "@/app/_lib/use-slot-label";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import { publicBaseUrl } from "@/app/_lib/public-base-url";
import { useRelativeTime } from "@/app/features/hiring/pipeline/PipelineShared";
import { useDeliveryCapability } from "@/app/features/shell/useDeliveryCapability";
import type { ScheduleInvite } from "@/app/_lib/schedule-store";
import { CALENDAR_STATUSES, type CalendarStatus } from "@/app/_lib/calendar/free-busy";

/** What the reschedule picker knows about the calendar behind its offered times — the
 *  honest three-state plus how many slots the calendar removed. Null until loaded. */
export type RescheduleCalendar = { status: CalendarStatus; dropped: number };

const asCalendarStatus = (v: unknown): CalendarStatus =>
  // An unknown/absent value is NOT "checked": the whole point is never to claim a
  // calendar was consulted on anything but the server saying so.
  CALENDAR_STATUSES.includes(v as CalendarStatus) ? (v as CalendarStatus) : "unavailable";

export type ArmedAction ={ token: string; action: "cancel" | "no_show" | "resolve_reconcile" | "decline_proposals" | "reinvite" };

export function useScheduleInviteLifecycle() {
  const t = useTranslations("scheduleTab.lifecycle");
  const relativeTime = useRelativeTime();
  // Failures resolve from the machine `code`, not the server's English `error`.
  const errMsg = useErrorMessage();
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
  const [armed, setArmed] = useState<ArmedAction | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [rescheduleToken, setRescheduleToken] = useState<string | null>(null);
  const [rescheduleSlots, setRescheduleSlots] = useState<{ value: string; label: string }[] | null>(null);
  // W1.4 honesty — the route has always sent calendarChecked/droppedForConflict and this
  // hook projected the payload down to `slots` alone, so a Google outage, a revoked grant
  // and a genuinely clear calendar all rendered as an unqualified list of times.
  const [rescheduleCalendar, setRescheduleCalendar] = useState<RescheduleCalendar | null>(null);
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
        toast.error(errMsg(d, t("actionFailed")));
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

  // Re-invite a candidate from a CLOSED row (declined / no_show / expired): mint a
  // FRESH scheduling link via the EXISTING invite route (new token, existing dispatch).
  // The store reconciles only against LIVE invites, so a terminal/expired row never
  // reused — a genuinely new pending invite is created and lands in the awaiting bucket
  // on the reload below. Honest delivery language keyed off the route's truthful claim.
  const reinvite = async (token: string, entryId: string | null) => {
    if (!entryId) return;
    setBusy(token);
    try {
      const r = await fetch("/api/schedule/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entryId }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        toast.error(errMsg(d, t("actionFailed")));
        return;
      }
      // The route returns the truthful delivery claim (sent only on a relayed 2xx,
      // else queued in the Outbox) — mirror the panel's sent/queued language.
      toast.success(d.delivery === "sent" ? t("reinviteSent") : t("reinviteQueued"));
      await loadInvites();
    } catch {
      toast.error(t("actionFailed"));
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
    setRescheduleCalendar(null);
    try {
      // Name the invite so the server conflict-checks its REAL length (a 90-minute
      // interview was being checked as 45, leaving its second half unchecked).
      const r = await fetch(`/api/schedule?slots=1&token=${encodeURIComponent(token)}`);
      const d = await r.json();
      setRescheduleSlots(Array.isArray(d.slots) ? d.slots : []);
      setRescheduleCalendar({
        status: d.calendarChecked === true ? "checked" : asCalendarStatus(d.calendarStatus),
        dropped: typeof d.droppedForConflict === "number" ? d.droppedForConflict : 0,
      });
    } catch {
      setRescheduleSlots([]);
      // The request itself failed, so nothing was checked and we cannot say why.
      setRescheduleCalendar({ status: "unavailable", dropped: 0 });
      toast.error(t("actionFailed"));
    }
  };

  // Reload the whole agenda from the ONE scheduling engine. Used after a re-invite (so
  // the freshly-minted pending link appears in the awaiting bucket). useCallback keeps
  // the Date.now() capture out of render scope (react-hooks/purity).
  const loadInvites = useCallback(async () => {
    try {
      const r = await fetch("/api/schedule");
      if (!r.ok) throw new Error();
      const p = await r.json();
      setInvites((p.invites as ScheduleInvite[]) ?? []);
      setLoadedAt(Date.now());
    } catch {
      setFailed(true);
    }
  }, []);

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

  const slotLine = (i: ScheduleInvite) =>
    i.slotAt
      ? `${slotLabel(i.slotAt, i.slot)}${i.durationMin ? ` · ${i.durationMin} min` : ""}`
      : (i.slot ?? "—");

  return {
    t,
    relativeTime,
    relayConfigured,
    slotLabel,
    slotLine,
    base,
    invites,
    loadedAt,
    failed,
    armed,
    setArmed,
    busy,
    rescheduleToken,
    setRescheduleToken,
    rescheduleSlots,
    setRescheduleSlots,
    rescheduleCalendar,
    runAction,
    reinvite,
    openReschedule,
    updateInvite,
  };
}
