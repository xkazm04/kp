import { NextResponse } from "next/server";
import { getOutboxEntry, getPipelineEntry, recordAutomationEvent } from "@/app/_lib/db";
import { sendComm } from "@/app/_lib/comms";
import { safeJsonError } from "@/app/_lib/api-response";

export const runtime = "nodejs";

// W6-1 (SIM2/DEVO5/DEVS4) — re-deliver a dead-lettered (or stuck-queued) comm.
// The system DELIBERATELY never auto-resends: business sends are gated on
// durable event markers (the hasEvent pattern), so re-running automation skips
// them — which made `failed` permanently unrecoverable in-product. This is the
// human-triggered recovery that doesn't bypass the audit log: the stored
// message re-dispatches through the live channel as a NEW outbox row (the
// original row is untouched, the trail stays append-only), and the resend is
// stamped on the candidate's history when the ref resolves to an entry.
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const original = getOutboxEntry(id);
    if (!original) return NextResponse.json({ error: "Message not found." }, { status: 404 });
    if (!original.recipient || !original.subject || !original.body || !original.kind) {
      return NextResponse.json({ error: "Message is missing fields and can't be resent." }, { status: 422 });
    }
    const resent = await sendComm({
      to: original.recipient,
      subject: original.subject,
      body: original.body,
      kind: original.kind,
      ref: original.ref ?? undefined,
    });
    if (original.ref && getPipelineEntry(original.ref)) {
      recordAutomationEvent(original.ref, "comm_resent", `${original.kind}: ${resent.status}`);
    }
    return NextResponse.json({ ok: true, entry: resent });
  } catch (error) {
    return safeJsonError(error, "api:comms:resend", "OUTREACH_FAILED");
  }
}
