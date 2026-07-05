import { NextRequest, NextResponse } from "next/server";
import { actOnPipelineEntry, getPipelineEntry } from "@/app/_lib/db";
import { dispatchInterviewConfirmation, dispatchInterviewerBrief } from "@/app/_lib/comms-dispatch";
import { deliveryClaim, isRelayConfigured, type DeliveryClaim } from "@/app/_lib/comms-truth";
import { getInterviewPrep } from "@/app/_lib/interview-prep";
import {
  bookedSlots,
  cancelAttendance,
  confirmAttendance,
  confirmScheduleInvite,
  flagScheduleInviteNeedsMoreSlots,
  getScheduleInviteByToken,
  markScheduleInviteNeedsReconcile,
  MAX_RESCHEDULES,
  rescheduleScheduleInvite,
  type ScheduleInvite,
} from "@/app/_lib/schedule-store";
import { offeredSlotFor, proposeSlots } from "@/app/_lib/schedule-slots";
import { isValidTimeZone } from "@/app/_lib/timezone";
import { logScheduleNoSlots, logScheduleReconcile } from "@/app/_lib/logger";
import { jsonOk, safeJsonError } from "@/app/_lib/api-response";
import { isShortNoticeBooking } from "@/app/_lib/interview-reminder-policy";
import { publicBaseUrl } from "@/app/_lib/public-base-url";
import { clientIpFrom, rateLimit, RATE_LIMITED_ERROR } from "@/app/_lib/rate-limit";


// Candidate-facing projection of an invite (idea-69d1e4fd). The route used to
// return the WHOLE ScheduleInvite row to the public token holder — including
// entryId (an internal pipeline_entries primary key, the same IDOR handle
// POST /api/schedule/invite and other entry-keyed flows accept) and
// reconcileReason (raw internal error text persisted by the reconcile flag).
// SchedulePicker only consumes these five fields; nothing else belongs on the
// public wire.
function publicInviteView(invite: ScheduleInvite) {
  return {
    candidateLabel: invite.candidateLabel,
    jobTitle: invite.jobTitle,
    status: invite.status,
    slot: invite.slot,
    // The ISO slot time — the candidate's OWN confirmed booking, surfaced so the
    // booked card can offer an "Add to calendar" (.ics) download (SCH1). Not an
    // internal handle (unlike entryId/reconcileReason, which stay off the wire).
    slotAt: invite.slotAt,
    durationMin: invite.durationMin,
    // The candidate's RSVP on their booking (idea-87af39c5), so the booked card
    // can show "Attendance confirmed" vs the confirm/cancel actions. Not an
    // internal handle — safe on the public wire.
    attendanceStatus: invite.attendanceStatus,
    // The interview join link, when the recruiter has set one — so the candidate's
    // booked card can show a "Join" button and bake it into their calendar event.
    meetingUrl: invite.meetingUrl,
  };
}

// GET → candidate-facing data: the invite + proposed slots.
export async function GET(_request: NextRequest, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const invite = getScheduleInviteByToken(token);
  if (!invite) return NextResponse.json({ error: "not found" }, { status: 404 });
  // A confirmed candidate may still self-reschedule (under the cap) — offer slots
  // in that case too, not just for a pending first booking. proposeSlots excludes
  // already-booked times, including this candidate's current one (they're moving
  // away from it). The cap stops the "change time" affordance from churning.
  const canReschedule = invite.status === "confirmed" && invite.rescheduleCount < MAX_RESCHEDULES;
  // Per-team calendar: only this invite's own team's confirmed slots block a time.
  const slots = invite.status !== "confirmed" || canReschedule ? proposeSlots(bookedSlots(invite.workspaceId)) : [];
  // The busiest-calendar edge (idea-5df8e10f): a pending invite whose entire
  // proposal horizon is already booked yields zero slots. Rather than handing
  // the candidate a silent dead-end, flag the invite so the recruiter can open
  // more times — the detection happens server-side on the read that surfaces the
  // emptiness, so the booking can't stall waiting on a candidate action. The
  // flag is idempotent and logs/counts only on the 0→1 transition, so a page
  // refresh doesn't re-alert; flagging is best-effort and never blocks the read.
  const noSlots = invite.status !== "confirmed" && slots.length === 0;
  if (noSlots) {
    try {
      if (flagScheduleInviteNeedsMoreSlots(token)) {
        await logScheduleNoSlots({ token, entry_id: invite.entryId });
      }
    } catch {
      /* flagging is best-effort — never block the candidate's read */
    }
  }
  return jsonOk({ invite: publicInviteView(invite), slots, noSlots, canReschedule });
}

// POST → candidate confirms a slot: record it, set it on the pipeline entry
// (approve_event honors the chosen slot), and send a confirmation + reminder.
export async function POST(request: NextRequest, context: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await context.params;
    // Side-effect-bearing public endpoint (a confirm dispatches candidate
    // email) — throttle per caller+token (idea-3e49abaf).
    if (!rateLimit(`sched:${clientIpFrom(request.headers)}:${token}`, { limit: 10, windowMs: 60_000 })) {
      return NextResponse.json({ error: RATE_LIMITED_ERROR }, { status: 429 });
    }
    const body = (await request.json().catch(() => ({}))) as {
      slot?: string;
      slotAt?: string;
      reschedule?: boolean;
      tz?: string;
      rsvp?: "confirm" | "cancel";
    };
    // The candidate's IANA timezone (idea-b51106df), captured so the recruiter
    // agenda can show a cross-border booking in the candidate's real local time.
    // Validated against the runtime's zone table — a spoofed/unknown value is
    // dropped to null rather than stored, so it can never make Intl throw later.
    const candidateTz = isValidTimeZone(body.tz) ? body.tz : null;
    const invite = getScheduleInviteByToken(token);
    if (!invite) return NextResponse.json({ error: "not found" }, { status: 404 });

    // RSVP (idea-87af39c5): a confirmed candidate confirms attendance or cancels,
    // reusing this token. Handled BEFORE the idempotent re-confirm echo so it isn't
    // swallowed. A cancel frees the slot and re-opens the invite for re-booking; the
    // entry-active guard (below, shared) also applies — a rejected/declined candidate
    // can't RSVP.
    if (body.rsvp === "confirm" || body.rsvp === "cancel") {
      if (invite.status !== "confirmed") {
        return NextResponse.json({ error: "There's no confirmed time to update yet." }, { status: 409 });
      }
      if (invite.entryId) {
        const linkedEntry = getPipelineEntry(invite.entryId);
        if (linkedEntry && linkedEntry.status !== "active") {
          return NextResponse.json({ error: "This interview is no longer available." }, { status: 409 });
        }
      }
      const updated = body.rsvp === "confirm" ? confirmAttendance(token) : cancelAttendance(token);
      if (!updated) return NextResponse.json({ error: "not found" }, { status: 404 });
      return jsonOk({ ok: true, invite: publicInviteView(updated), rsvp: body.rsvp });
    }

    // A confirmed invite hit again WITHOUT a reschedule intent is an idempotent
    // re-confirm (double-submit / stale tab) — just echo the booking. A reschedule
    // (body.reschedule) falls through to the move path below.
    if (invite.status === "confirmed" && !body.reschedule) {
      return jsonOk({ ok: true, invite: publicInviteView(invite) });
    }

    // Don't let a still-valid token book OR move an interview for a candidate
    // rejected/declined since the link was minted (status goes terminal; Hired
    // keeps 'active'). approve_event guards this server-side too (defense-in-depth).
    // Applies to both a first confirm and a reschedule.
    if (invite.entryId) {
      const linkedEntry = getPipelineEntry(invite.entryId);
      if (linkedEntry && linkedEntry.status !== "active") {
        return NextResponse.json({ error: "This interview is no longer available." }, { status: 409 });
      }
    }

    // Only a slot the server itself would offer is bookable (idea-e05aedfb):
    // the handler used to trust body.slot/body.slotAt verbatim, letting a token
    // holder book a 3am-Sunday/past time and inject arbitrary label text into
    // the confirmation + reminder EMAILS and the recruiter activity feed. The
    // submitted time is validated structurally and the label is RE-DERIVED
    // server-side — the client's body.slot is ignored entirely. Shared by confirm
    // and reschedule.
    const offered = offeredSlotFor(body.slotAt);
    if (!offered) {
      return NextResponse.json({ error: "That time isn't one of the offered slots — please pick from the list." }, { status: 400 });
    }
    const slot = offered.label;

    // Record the chosen slot on the linked pipeline entry and send the
    // confirmation. Shared by the first confirm and a reschedule so the
    // approve_event + dispatch + reconcile-on-failure handling can't drift between
    // them. Returns the TRUTHFUL delivery claim (REC-10): "sent" only for a
    // relayed 2xx, "queued" when no relay is configured (the row is a terminal
    // local-outbox record — the candidate page must not promise "we've sent a
    // confirmation"), "failed" when delivery dead-lettered/threw (worst for
    // short-notice bookings, which get no separate timed reminder).
    // approve_event records the slot WITHOUT regressing an entry already past
    // Interview, so a reschedule of an in-progress interview is safe.
    const recordBooking = async (booked: ScheduleInvite): Promise<DeliveryClaim> => {
      // No linked entry ⇒ nothing to confirm to — fall back to capability so the
      // page copy stays consistent with what a dispatch WOULD have done.
      const blindClaim = deliveryClaim(isRelayConfigured());
      if (!invite.entryId) return blindClaim;
      const entry = getPipelineEntry(invite.entryId);
      if (!entry) return blindClaim;
      try {
        actOnPipelineEntry(entry.id, "approve_event", slot);
      } catch (advanceError) {
        // The slot is recorded and the candidate sees "booked", but the pipeline
        // entry didn't advance (stage gate not ready) — make the drift findable
        // rather than swallow it: flag the invite, count it, and log it.
        const reason = advanceError instanceof Error ? advanceError.message : String(advanceError);
        markScheduleInviteNeedsReconcile(token, reason);
        await logScheduleReconcile({ token, entry_id: entry.id, slot, error: reason });
      }
      try {
        const slotAtMs = booked.slotAt ? Date.parse(booked.slotAt) : NaN;
        const bookedAtMs = booked.confirmedAt ? Date.parse(booked.confirmedAt) : NaN;
        const shortNotice =
          !Number.isNaN(slotAtMs) && !Number.isNaN(bookedAtMs) && isShortNoticeBooking(slotAtMs, bookedAtMs);
        const confirmationStatus = await dispatchInterviewConfirmation(entry, slot, {
          shortNotice,
          durationMin: booked.durationMin,
          // The candidate's one durable way back to reschedule (SCH2) / .ics —
          // the picker page is gone once the tab closes.
          rescheduleLink: `${publicBaseUrl(new URL(request.url).origin)}/schedule/${token}`,
        });
        // Brief the assigned interviewer too (interview-prep #2). Best-effort: a
        // brief failure must never turn the candidate's confirmed booking into an
        // error, so it's isolated and only logged. dispatchInterviewerBrief is the
        // gatekeeper — it no-ops (or records interviewer_brief_skipped) when the
        // prep carries no interviewer / no deliverable address.
        try {
          const prep = getInterviewPrep(entry.id);
          const p = (prep?.payload ?? {}) as { interviewer?: unknown; scenario?: unknown; focusAreas?: unknown; lang?: unknown };
          await dispatchInterviewerBrief(entry, slot, {
            interviewer: typeof p.interviewer === "string" ? p.interviewer : null,
            durationMin: booked.durationMin,
            slotAtIso: booked.slotAt,
            scenario: typeof p.scenario === "string" ? p.scenario : null,
            focusAreas: Array.isArray(p.focusAreas) ? p.focusAreas.filter((f): f is string => typeof f === "string") : null,
            lang: typeof p.lang === "string" ? p.lang : null,
          });
        } catch (briefError) {
          const reason = briefError instanceof Error ? briefError.message : String(briefError);
          await logScheduleReconcile({ token, entry_id: entry.id, slot, error: `interviewer brief failed: ${reason}` });
        }
        return deliveryClaim(isRelayConfigured(), confirmationStatus);
      } catch (dispatchError) {
        const reason = dispatchError instanceof Error ? dispatchError.message : String(dispatchError);
        markScheduleInviteNeedsReconcile(token, `confirmation email failed: ${reason}`);
        await logScheduleReconcile({ token, entry_id: entry.id, slot, error: `confirmation dispatch failed: ${reason}` });
        return "failed";
      }
    };

    // RESCHEDULE — a confirmed candidate moving to a new time. Same collision
    // authority as confirm (rescheduleScheduleInvite's transaction), bounded by
    // MAX_RESCHEDULES, and the old slot is freed back into the pool.
    if (invite.status === "confirmed") {
      const moved = rescheduleScheduleInvite(token, slot, offered.value, candidateTz);
      if (!moved.ok) {
        if (moved.reason === "taken") {
          return NextResponse.json(
            { error: "That time was just taken — please pick another.", invite: moved.invite ? publicInviteView(moved.invite) : null },
            { status: 409 }
          );
        }
        if (moved.reason === "limit") {
          return NextResponse.json(
            { error: "You've changed your interview time a few times already — reply to your confirmation email and we'll help you find a slot." },
            { status: 409 }
          );
        }
        return NextResponse.json({ error: "not found" }, { status: 404 });
      }
      const confirmationDelivery = await recordBooking(moved.invite);
      return jsonOk({
        ok: true,
        invite: publicInviteView(moved.invite),
        // Legacy boolean kept for older clients; `confirmationDelivery` is the
        // honest three-state the picker copy keys off (REC-10).
        confirmationSent: confirmationDelivery !== "failed",
        confirmationDelivery,
        rescheduled: true,
      });
    }

    // FIRST CONFIRM — a pending invite booking its slot.
    const result = confirmScheduleInvite(token, slot, offered.value, candidateTz);
    if (!result.ok) {
      if (result.reason === "taken") {
        // Another candidate confirmed this exact time between page load and submit.
        return NextResponse.json(
          { error: "That time was just taken — please pick another.", invite: result.invite ? publicInviteView(result.invite) : null },
          { status: 409 }
        );
      }
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    const confirmationDelivery = await recordBooking(result.invite);
    return jsonOk({
      ok: true,
      invite: publicInviteView(result.invite),
      confirmationSent: confirmationDelivery !== "failed",
      confirmationDelivery,
    });
  } catch (error) {
    // Raw err.message would surface SQLite/dispatch internals on a public
    // token route — same hygiene as the pipeline/interview routes.
    return safeJsonError(error, "api:schedule:confirm", "SCHEDULE_CONFIRM_FAILED");
  }
}
