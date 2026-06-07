import { NextRequest, NextResponse } from "next/server";
import { actOnPipelineEntry, getPipelineEntry } from "@/app/_lib/db";
import { dispatchInterviewConfirmation } from "@/app/_lib/comms-dispatch";
import {
  bookedSlots,
  confirmScheduleInvite,
  flagScheduleInviteNeedsMoreSlots,
  getScheduleInviteByToken,
  markScheduleInviteNeedsReconcile,
  type ScheduleInvite,
} from "@/app/_lib/schedule-store";
import { offeredSlotFor, proposeSlots } from "@/app/_lib/schedule-slots";
import { logScheduleNoSlots, logScheduleReconcile } from "@/app/_lib/logger";
import { jsonOk, safeJsonError } from "@/app/_lib/api-response";
import { isShortNoticeBooking } from "@/app/_lib/interview-reminder-policy";
import { clientIpFrom, rateLimit, RATE_LIMITED_ERROR } from "@/app/_lib/rate-limit";

export const runtime = "nodejs";

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
    durationMin: invite.durationMin,
  };
}

// GET → candidate-facing data: the invite + proposed slots.
export async function GET(_request: NextRequest, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const invite = getScheduleInviteByToken(token);
  if (!invite) return NextResponse.json({ error: "not found" }, { status: 404 });
  const slots = invite.status === "confirmed" ? [] : proposeSlots(bookedSlots());
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
  return jsonOk({ invite: publicInviteView(invite), slots, noSlots });
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
    const body = (await request.json().catch(() => ({}))) as { slot?: string; slotAt?: string };
    const invite = getScheduleInviteByToken(token);
    if (!invite) return NextResponse.json({ error: "not found" }, { status: 404 });
    if (invite.status === "confirmed") return jsonOk({ ok: true, invite: publicInviteView(invite) });

    // Only a slot the server itself would offer is bookable (idea-e05aedfb):
    // the handler used to trust body.slot/body.slotAt verbatim, letting a token
    // holder book a 3am-Sunday/past time and inject arbitrary label text into
    // the confirmation + reminder EMAILS and the recruiter activity feed. The
    // submitted time is validated structurally and the label is RE-DERIVED
    // server-side — the client's body.slot is ignored entirely.
    const offered = offeredSlotFor(body.slotAt);
    if (!offered) {
      return NextResponse.json({ error: "That time isn't one of the offered slots — please pick from the list." }, { status: 400 });
    }
    const slot = offered.label;

    const result = confirmScheduleInvite(token, slot, offered.value);
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
    const confirmed = result.invite;
    // Whether the confirmation email actually went out. The candidate page must not
    // promise "we've sent a confirmation" when delivery failed — worst for
    // short-notice bookings, which get no separate timed reminder.
    let confirmationSent = true;
    if (invite.entryId) {
      const entry = getPipelineEntry(invite.entryId);
      if (entry) {
        try {
          actOnPipelineEntry(entry.id, "approve_event", slot);
        } catch (advanceError) {
          // The slot is recorded and the candidate sees "booked", but the pipeline
          // entry didn't advance (stage gate not ready) — without a signal this is
          // an invisible invite/pipeline divergence. Keep the lenient behaviour, but
          // make the drift findable: flag the invite, count it, and log it.
          const reason = advanceError instanceof Error ? advanceError.message : String(advanceError);
          markScheduleInviteNeedsReconcile(token, reason);
          await logScheduleReconcile({ token, entry_id: entry.id, slot, error: reason });
        }
        try {
          // Short-notice bookings won't get a separate timed reminder (the slot is
          // too close — see interview-reminder-policy.ts), so the confirmation must
          // read as the candidate's only heads-up rather than promising a reminder.
          const slotAtMs = confirmed.slotAt ? Date.parse(confirmed.slotAt) : NaN;
          const bookedAtMs = confirmed.confirmedAt ? Date.parse(confirmed.confirmedAt) : NaN;
          const shortNotice =
            !Number.isNaN(slotAtMs) && !Number.isNaN(bookedAtMs) && isShortNoticeBooking(slotAtMs, bookedAtMs);
          await dispatchInterviewConfirmation(entry, slot, { shortNotice, durationMin: confirmed.durationMin });
        } catch (dispatchError) {
          // Don't swallow a delivery failure silently: flag + log it (reuse the
          // reconcile machinery) and tell the client so the success copy softens
          // instead of falsely claiming a confirmation was sent.
          confirmationSent = false;
          const reason = dispatchError instanceof Error ? dispatchError.message : String(dispatchError);
          markScheduleInviteNeedsReconcile(token, `confirmation email failed: ${reason}`);
          await logScheduleReconcile({ token, entry_id: entry.id, slot, error: `confirmation dispatch failed: ${reason}` });
        }
      }
    }
    return jsonOk({ ok: true, invite: publicInviteView(confirmed), confirmationSent });
  } catch (error) {
    // Raw err.message would surface SQLite/dispatch internals on a public
    // token route — same hygiene as the pipeline/interview routes.
    return safeJsonError(error, "api:schedule:confirm", "SCHEDULE_CONFIRM_FAILED");
  }
}
