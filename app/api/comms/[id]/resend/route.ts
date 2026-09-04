import { NextResponse } from "next/server";
import { getOutboxEntry, listOutboxFiltered } from "@/app/_lib/db/devcase";
import { getPipelineEntry, recordAutomationEvent } from "@/app/_lib/db/pipeline";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { CommsSuppressedError, sendComm } from "@/app/_lib/comms";
import { SIM_COMMS_CHANNEL } from "@/app/_lib/comms-dispatch";
import { isDeliverableAddress } from "@/app/_lib/comms-recipient";
import { jsonRefusal, safeJsonError } from "@/app/_lib/api-response";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";


// In-flight resends for the current process, keyed by outbox id, so a double-click
// (or a retried fetch, or two recruiters on the dead-letter list) that races BEFORE
// the first send writes its row can't both dispatch. Cleared in `finally`.
const resendInFlight = new Set<string>();

// Per-IP budget. This is the ONE door in the assignments loop that spends real
// email on demand: every accepted call dispatches through the live relay and
// writes an outbox row. It is operator-gated, and open mode
// (KP_OPERATOR_PASSWORD unset) makes that gate a documented no-op for the ENTIRE
// API, so the limiter is the real bound. 60/10min sits far above a recruiter
// working a dead-letter list by hand (one click per message, each one read
// first) and pins a scripted loop at 6/min.
const RESEND_RATE_LIMIT = { limit: 60, windowMs: 10 * 60_000 };

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
    return jsonRefusal("COMM_RESEND_IN_PROGRESS", 409, { recovered: true });
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
    // A (SIM) row was recorded on the simulation channel precisely so it never reaches
    // the relay (wave 16); resending it would. Refuse with a code the outbox renders.
    if (original.channel === SIM_COMMS_CHANNEL) return jsonRefusal("COMM_SIMULATION_ROW", 409);
    // Per-IP, AFTER the cheap refusals (in-flight, unknown id, missing fields) so a
    // rejected click costs no budget, and BEFORE the dedup read and the relay call.
    if (!rateLimit(`comms-resend:${clientIpFrom(request.headers)}`, RESEND_RATE_LIMIT)) {
      return jsonRefusal("TOO_MANY_REQUESTS", 429);
    }
    // The correlation key the dedup below reads. A message with a `ref` keeps it, so
    // the recovery lands beside the thing it recovers. A REFLESS dead letter (a KO
    // decline, a comm whose subject was never a pipeline entry) had NO key at all, so
    // the whole dedup block was skipped for it and the same message could be
    // re-dispatched without bound — one delivery per click, for as long as anyone
    // clicked. Its OWN outbox id is the key: durable (it survives a restart, unlike
    // the in-process Set above) and it makes the recovery row point at the message it
    // recovers. Refs are correlation keys, not foreign keys — the acknowledgement path
    // already files one against a submission id — so nothing downstream is surprised
    // by one that names an outbox row; the automation-event stamp below still reads
    // `original.ref` and so still fires only for a real pipeline entry.
    const dedupRef = original.ref ?? original.id;
    // Recovery dedup (server-side, not just the client's disabled button): if a NEWER
    // real DELIVERY (sent/queued) already exists for this (ref, kind) since the original,
    // the message was already re-sent (an earlier resend, or automation re-fired it).
    // Don't deliver a duplicate offer/rejection — report it as recovered. A `bounced`
    // RECEIPT row is NOT a delivery (it's the async failure signal), so it must not
    // count here — otherwise a bounced message could never be resent (comms #3).
    const alreadyRecovered = listOutboxFiltered({ ref: dedupRef, kind: original.kind }, ws).some(
      (m) => m.id !== original.id && m.status !== "failed" && m.status !== "bounced" && m.createdAt > original.createdAt
    );
    if (alreadyRecovered) {
      return jsonRefusal("COMM_ALREADY_RESENT", 409, { recovered: true });
    }
    const resent = await sendComm({
      to: correctedRecipient ?? original.recipient,
      subject: original.subject,
      body: original.body,
      kind: original.kind,
      // The dedup key, so a SECOND resend of a refless dead letter finds this row.
      ref: dedupRef,
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
    // A REFUSAL, not a fault: sendComm's shared precondition (comms.ts
    // commsSendSuppression) stopped the send because this candidate may no longer be
    // contacted — anonymized, consent expired, or the outreach sequence stopped. It
    // reaches here as a throw because that is how the channel says "the message did
    // NOT go out"; answering it through safeJsonError painted an intended, correct
    // decision as a 500 the recruiter would retry. 409: the door works, the state
    // forbids it.
    if (error instanceof CommsSuppressedError) return jsonRefusal("COMMS_SUPPRESSED", 409);
    return safeJsonError(error, "api:comms:resend", "OUTREACH_FAILED");
  } finally {
    resendInFlight.delete(id);
  }
}
