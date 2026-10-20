"use client";

// Interaction state and recruiter actions for InviteLifecyclePanel, split out of
// ScheduleInviteLifecyclePanel.tsx so the component file stays under the 200-line
// cap. Returns everything the panel and its section components need; no JSX here.
//
// It no longer FETCHES or HOLDS the agenda (challenge-r02 schedule-calendar-invites/A).
// ScheduleTab owns the one invite list (useScheduleTab) and renders this panel as its
// child, so the list arrives as props and every write goes through the owner's
// writers — which adopt the route's answer into the same list the week grid reads,
// re-read where the write moved the pipeline, and announce on the live-refresh bus.
// Before, this hook kept a second copy from its own agenda read: a grid booking never
// reached it, and its accept/cancel never reached the grid.

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "@/app/_components/toast-store";
import { useSlotLabel } from "@/app/_lib/use-slot-label";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import { publicBaseUrl } from "@/app/_lib/public-base-url";
import { useRelativeTime } from "@/app/features/hiring/pipeline/PipelineShared";
import { useDeliveryCapability } from "@/app/features/shell/useDeliveryCapability";
import type { ScheduleInvite } from "@/app/_lib/schedule-store";
import { isInviteActionVerb, type ScheduleAgendaView } from "./scheduleAgenda";

export type ArmedAction ={ token: string; action: "cancel" | "no_show" | "resolve_reconcile" | "decline_proposals" | "reinvite" };

export function useScheduleInviteLifecycle(agenda: ScheduleAgendaView) {
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
  // The owner's list, its load-time "now" (so the upcoming/past split stays a pure
  // function of props during render — react-hooks/purity), and the stated bound: the
  // agenda read returns at most `limit` invites and says when it hit it.
  const { invites, loadedAt, failed, truncated } = agenda;
  // Direction 2 — recruiter-side invite control. `armed` is the two-step inline
  // confirm latch (token+action) reused from the app's delete idiom; `busy` gates a
  // row while its action is in flight. (The recruiter reschedule sub-flow was
  // removed 2026-08-10 — time changes come from the candidate's link/proposals.)
  const [armed, setArmed] = useState<ArmedAction | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Run a recruiter action against an invite through the owner, which adopts the
  // server's returned row so it re-buckets in place (a cancel drops it to awaiting, a
  // no-show to closed, an accepted proposal to upcoming AND off the grid's pending
  // list, a resolve clears the flag) on both surfaces at once.
  const runAction = async (token: string, action: string, slotAt?: string) => {
    if (!isInviteActionVerb(action)) return false;
    setBusy(token);
    try {
      const res = await agenda.runInviteAction(token, action, slotAt);
      if (!res.ok) {
        toast.error(errMsg(res.body, t("actionFailed")));
        return false;
      }
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
  // on the owner's re-read. Honest delivery language keyed off the route's truthful claim.
  const reinvite = async (token: string, entryId: string | null) => {
    if (!entryId) return;
    setBusy(token);
    try {
      const res = await agenda.reinviteEntry(entryId);
      if (!res.ok) {
        toast.error(errMsg(res.body, t("actionFailed")));
        return;
      }
      // The route returns the truthful delivery claim (sent only on a relayed 2xx,
      // else queued in the Outbox) — mirror the panel's sent/queued language.
      toast.success(res.body.delivery === "sent" ? t("reinviteSent") : t("reinviteQueued"));
    } catch {
      toast.error(t("actionFailed"));
    } finally {
      setBusy(null);
      setArmed(null);
    }
  };

  // Patch one invite in place (after a meeting link save) so the row + its calendar
  // event refresh without a full refetch — in the owner's one list.
  const updateInvite = (token: string, patch: Partial<ScheduleInvite>) => agenda.adoptMeetingPatch(token, patch);

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
    truncated,
    armed,
    setArmed,
    busy,
    runAction,
    reinvite,
    updateInvite,
  };
}
