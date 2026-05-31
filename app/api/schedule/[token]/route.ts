import { NextRequest, NextResponse } from "next/server";
import { actOnPipelineEntry, getPipelineEntry } from "@/app/_lib/db";
import { dispatchInterviewConfirmation } from "@/app/_lib/comms-dispatch";
import { bookedSlots, confirmScheduleInvite, getScheduleInviteByToken, proposeSlots } from "@/app/_lib/schedule-store";

export const runtime = "nodejs";

// GET → candidate-facing data: the invite + proposed slots.
export async function GET(_request: NextRequest, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const invite = getScheduleInviteByToken(token);
  if (!invite) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ invite, slots: invite.status === "confirmed" ? [] : proposeSlots(bookedSlots()) });
}

// POST → candidate confirms a slot: record it, set it on the pipeline entry
// (approve_event honors the chosen slot), and send a confirmation + reminder.
export async function POST(request: NextRequest, context: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await context.params;
    const body = (await request.json().catch(() => ({}))) as { slot?: string; slotAt?: string };
    const invite = getScheduleInviteByToken(token);
    if (!invite) return NextResponse.json({ error: "not found" }, { status: 404 });
    if (invite.status === "confirmed") return NextResponse.json({ ok: true, invite });

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
        } catch {
          /* slot still recorded on the invite even if the stage gate isn't ready */
        }
        try {
          await dispatchInterviewConfirmation(entry, slot);
        } catch {
          /* best-effort delivery */
        }
      }
    }
    return NextResponse.json({ ok: true, invite: confirmed });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "confirm failed" }, { status: 500 });
  }
}
