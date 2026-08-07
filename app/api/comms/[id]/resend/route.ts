import { NextResponse } from "next/server";
import { getOutboxEntry, listOutboxFiltered } from "@/app/_lib/db/devcase";
import { getPipelineEntry, recordAutomationEvent } from "@/app/_lib/db/pipeline";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { sendComm } from "@/app/_lib/comms";
import { isDeliverableAddress } from "@/app/_lib/comms-recipient";
import { safeJsonError } from "@/app/_lib/api-response";


// In-flight resends for the current process, keyed by outbox id, so a double-click
// (or a retried fetch, or two recruiters on the dead-letter list) that races BEFORE
// the first send writes its row can't both dispatch. Cleared in `finally`.
const resendInFlight = new Set<string>();

// W6-1 (SIM2/DEVO5/DEVS4) — re-deliver a dead-lettered (or stuck-queued) comm.
// The system DELIBERATELY never auto-resends: business sends are gated on
// durable event markers (the hasEvent pattern), so re-running automation skips
// them — which made `failed` permanently unrecoverable in-product. This is the
// human-triggered recovery that doesn't bypass the audit log: the stored
// message re-dispatches through the live channel as a NEW outbox row (the
// original row is untouched, the trail stays append-only), and the resend is
// stamped on the candidate's history when the ref resolves to an entry.
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  // Collapse a concurrent double-fire within this process before any send work.
  if (resendInFlight.has(id)) {
    return NextResponse.json({ recovered: true, error: "A resend for this message is already in progress." }, { status: 409 });
  }
  resendInFlight.add(id);
  try {
    // Optional corrected recipient — a BOUNCED message resent to the SAME address
    // just bounces again (comms #3), so the Comms Center lets the recruiter supply
    // a fixed address. Ignored unless it is a deliverable email; else we fall back
    // to the original recipient (a plain failed-dead-letter resend sends no body).
    const overrideBody = (await request.json().catch(() => null)) as { recipient?: unknown } | null;
    const correctedRecipient =
      typeof overrideBody?.recipient === "string" && isDeliverableAddress(overrideBody.recipient.trim())
        ? overrideBody.recipient.trim()
        : null;

    const ws = await currentWorkspace();
    const original = getOutboxEntry(id, ws);
    if (!original) return NextResponse.json({ error: "Message not found." }, { status: 404 });
    if (!original.recipient || !original.subject || !original.body || !original.kind) {
      return NextResponse.json({ error: "Message is missing fields and can't be resent." }, { status: 422 });
    }
    // Recovery dedup (server-side, not just the client's disabled button): if a NEWER
    // real DELIVERY (sent/queued) already exists for this (ref, kind) since the original,
    // the message was already re-sent (an earlier resend, or automation re-fired it).
    // Don't deliver a duplicate offer/rejection — report it as recovered. A `bounced`
    // RECEIPT row is NOT a delivery (it's the async failure signal), so it must not
    // count here — otherwise a bounced message could never be resent (comms #3).
    if (original.ref) {
      const alreadyRecovered = listOutboxFiltered({ ref: original.ref, kind: original.kind }, ws).some(
        (m) => m.id !== original.id && m.status !== "failed" && m.status !== "bounced" && m.createdAt > original.createdAt
      );
      if (alreadyRecovered) {
        return NextResponse.json(
          { recovered: true, error: "Already re-sent — a newer delivery exists for this message." },
          { status: 409 }
        );
      }
    }
    const resent = await sendComm({
      to: correctedRecipient ?? original.recipient,
      subject: original.subject,
      body: original.body,
      kind: original.kind,
      ref: original.ref ?? undefined,
      // The original was read from THIS workspace (getOutboxEntry(id, ws)), so the
      // recovery row belongs beside it. Only consulted when `ref` names no entry —
      // an entry-less comm (a KO decline) would otherwise resend into the default
      // team's Comms Center and vanish from the one that triggered it.
      workspaceId: ws,
    });
    if (original.ref && getPipelineEntry(original.ref, ws)) {
      recordAutomationEvent(original.ref, "comm_resent", `${original.kind}: ${resent.status}`, ws);
    }
    return NextResponse.json({ ok: true, entry: resent });
  } catch (error) {
    return safeJsonError(error, "api:comms:resend", "OUTREACH_FAILED");
  } finally {
    resendInFlight.delete(id);
  }
}
