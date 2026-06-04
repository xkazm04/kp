import { NextRequest, NextResponse } from "next/server";
import { actOnPipelineEntry, getPipelineEntry } from "@/app/_lib/db";
import { dispatchInterviewConfirmation } from "@/app/_lib/comms-dispatch";
import {
  bookedSlots,
  confirmScheduleInvite,
  getScheduleInviteByToken,
  markScheduleInviteNeedsReconcile,
  proposeSlots,
} from "@/app/_lib/schedule-store";
import { logScheduleReconcile } from "@/app/_lib/logger";
import { jsonError, jsonOk } from "@/app/_lib/api-response";
import { isShortNoticeBooking } from "@/app/_lib/interview-reminder-policy";

export const runtime = "nodejs";

// GET → candidate-facing data: the invite + proposed slots.
export async function GET(_request: NextRequest, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const invite = getScheduleInviteByToken(token);
  if (!invite) return NextResponse.json({ error: "not found" }, { status: 404 });
  return jsonOk({ invite, slots: invite.status === "confirmed" ? [] : proposeSlots(bookedSlots()) });
}

// POST → candidate confirms a slot: record it, set it on the pipeline entry
// (approve_event honors the chosen slot), and send a confirmation + reminder.
export async function POST(request: NextRequest, context: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await context.params;
    const body = (await request.json().catch(() => ({}))) as { slot?: string; slotAt?: string };
    const invite = getScheduleInviteByToken(token);
    if (!invite) return NextResponse.json({ error: "not found" }, { status: 404 });
    if (invite.status === "confirmed") return jsonOk({ ok: true, invite });

    const slot = (body.slot ?? "").trim();
    if (!slot) return NextResponse.json({ error: "slot is required" }, { status: 400 });

    const result = confirmScheduleInvite(token, slot, body.slotAt ?? null);
    if (!result.ok) {
      if (result.reason === "taken") {
        // Another candidate confirmed this exact time between page load and submit.
        return NextResponse.json(
          { error: "That time was just taken — please pick another.", invite: result.invite }, { status: 409 }
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
          await dispatchInterviewConfirmation(entry, slot, { shortNotice });
        } catch {
          /* best-effort delivery */
        }
      }
    }
    return jsonOk({ ok: true, invite: confirmed });
  } catch (error) {
    return jsonError(error, "confirm failed");
  }
}
