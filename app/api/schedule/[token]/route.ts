import { NextRequest, NextResponse } from "next/server";
import { actOnPipelineEntry, getPipelineEntry } from "@/app/_lib/db";
import { dispatchInterviewConfirmation } from "@/app/_lib/comms-dispatch";
import {
  bookedSlots,
  confirmScheduleInvite,
  getScheduleInviteByToken,
  markScheduleInviteNeedsReconcile,
  type ScheduleInvite,
} from "@/app/_lib/schedule-store";
import { offeredSlotFor, proposeSlots } from "@/app/_lib/schedule-slots";
import { logScheduleReconcile } from "@/app/_lib/logger";
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
  return jsonOk({ invite: publicInviteView(invite), slots: invite.status === "confirmed" ? [] : proposeSlots(bookedSlots()) });
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
        } catch {
          /* best-effort delivery */
        }
      }
    }
    return jsonOk({ ok: true, invite: publicInviteView(confirmed) });
  } catch (error) {
    // Raw err.message would surface SQLite/dispatch internals on a public
    // token route — same hygiene as the pipeline/interview routes.
    return safeJsonError(error, "api:schedule:confirm", "SCHEDULE_CONFIRM_FAILED");
  }
}
