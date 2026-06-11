import { getPipelineEntry, recordOutbox, type OutboxEntry } from "./db";
import { COMMS_RELAY_RETRY, isRetryableHttpStatus, type OutboxStatus } from "./comms-status";
import { buildCommEnvelope, type CommEnvelope } from "./comms-envelope";
import { logComms } from "./logger";

// Direction B — outbound communications. Pluggable channel, mirroring the deterministic-
// fallback pattern: a durable local OUTBOX by default (always works, also serves as the
// audit log), or a real HTTP relay when COMMS_WEBHOOK_URL is set (wire to SendGrid / a
// mail relay / Zapier / an ATS). Every message is recorded either way.
//
// DELIVERY CONTRACT (statuses defined once in comms-status.ts; full write-up in
// docs/COMMS_DELIVERY.md):
//   • queued  — local outbox, no relay configured. A *terminal* dev state: the outbox
//               IS the delivery target (dev inbox + audit log); nothing dequeues it.
//   • sent    — relayed successfully (HTTP 2xx).
//   • failed  — relay configured but delivery dead-lettered (non-retryable response, or
//               a transient failure that exhausted COMMS_RELAY_RETRY). Alerted loudly.
//
// RECIPIENT CONTRACT: `msg.to` is whatever `candidateRecipient` (comms-dispatch.ts)
// resolves — a human label / candidate id / the literal "candidate" — never an email,
// because the data model stores none. A configured relay/ATS maps that identifier to a
// real address; `msg.ref` (the pipeline entry id) is always carried so an unaddressable
// message stays traceable in the audit log.

export type OutboundMessage = { to: string; subject: string; body: string; kind: string; ref?: string };

export interface CommsChannel {
  readonly name: string;
  send(msg: OutboundMessage): Promise<OutboxEntry>;
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// Local outbox: records the message as "queued". This is terminal — offline there is no
// relay to deliver to, so the row in dev_outbox is both the delivered artifact and the
// audit entry. (Set COMMS_WEBHOOK_URL to switch to the WebhookChannel for real delivery.)
class OutboxChannel implements CommsChannel {
  readonly name = "outbox";
  async send(msg: OutboundMessage): Promise<OutboxEntry> {
    return recordOutbox({ recipient: msg.to, subject: msg.subject, body: msg.body, kind: msg.kind, channel: this.name, status: "queued", ref: msg.ref });
  }
}

// Real channel: POST the message to a configured relay. Transient failures (network /
// 429 / 5xx) are retried with bounded exponential backoff; a non-retryable response, or
// exhausting the retries, dead-letters the message (status `failed`) and raises a loud
// alert — a dropped offer/rejection must never look as benign as a local `queued` row.
//
// E8 — the wire payload is the versioned kp.comm.v1 envelope (comms-envelope.ts,
// documented in docs/OUTBOUND_EXPORT.md): the flat legacy fields verbatim, plus
// candidate/job/stage context enriched from the pipeline entry the message
// references — so a relay can map kp → any ATS without calling back.
class WebhookChannel implements CommsChannel {
  readonly name = "webhook";
  constructor(private readonly url: string) {}

  async send(msg: OutboundMessage): Promise<OutboxEntry> {
    // `ref` is the pipeline entry id for every pipeline dispatcher; dev-case and
    // slot refs simply miss and ship null context (the flat fields still deliver).
    const envelope = buildCommEnvelope(msg, msg.ref ? getPipelineEntry(msg.ref) : null, new Date().toISOString());
    const { status, attempts, detail } = await this.deliver(envelope);
    if (status === "failed") await this.alertDeadLetter(msg, attempts, detail);
    return recordOutbox({ recipient: msg.to, subject: msg.subject, body: msg.body, kind: msg.kind, channel: this.name, status, ref: msg.ref });
  }

  // Attempt delivery with bounded retry. Returns the terminal status plus how many
  // attempts ran and the last failure detail (for the dead-letter alert / audit).
  private async deliver(envelope: CommEnvelope): Promise<{ status: OutboxStatus; attempts: number; detail: string }> {
    let detail = "";
    for (let attempt = 1; attempt <= COMMS_RELAY_RETRY.maxAttempts; attempt++) {
      try {
        const r = await fetch(this.url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(envelope) });
        if (r.ok) return { status: "sent", attempts: attempt, detail: "" };
        detail = `http ${r.status}`;
        // Permanent (caller/config) error — retrying changes nothing, dead-letter now.
        if (!isRetryableHttpStatus(r.status)) return { status: "failed", attempts: attempt, detail };
      } catch (err) {
        // Network / DNS / abort — transient, fall through to backoff + retry.
        detail = err instanceof Error ? err.message : "network error";
      }
      if (attempt < COMMS_RELAY_RETRY.maxAttempts) {
        await delay(COMMS_RELAY_RETRY.baseDelayMs * 2 ** (attempt - 1));
      }
    }
    return { status: "failed", attempts: COMMS_RELAY_RETRY.maxAttempts, detail };
  }

  // Escalation the old silent `failed` row never raised: a candidate-facing message did
  // not reach the relay. Loud (console.error) + durable (comms.log) so a dropped offer
  // or rejection is visible, not quietly swallowed.
  private async alertDeadLetter(msg: OutboundMessage, attempts: number, detail: string): Promise<void> {
    console.error(`[comms] DEAD-LETTER: ${msg.kind} to "${msg.to}" (ref=${msg.ref ?? "—"}) failed after ${attempts} attempt(s): ${detail}`);
    await logComms({ kind: msg.kind, recipient: msg.to, ref: msg.ref ?? null, channel: this.name, status: "failed", attempts, detail });
  }
}

export function getCommsChannel(): CommsChannel {
  const url = process.env.COMMS_WEBHOOK_URL;
  return url ? new WebhookChannel(url) : new OutboxChannel();
}

/** Convenience: dispatch one message through the active channel. */
export async function sendComm(msg: OutboundMessage): Promise<OutboxEntry> {
  return getCommsChannel().send(msg);
}
