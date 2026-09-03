import { recordOutbox, type OutboxEntry } from "./db/devcase";
import { getEntryWorkspace, getPipelineEntry } from "./db/pipeline";
import { COMMS_RELAY_RETRY, isRetryableHttpStatus, type OutboxStatus } from "./comms-status";
import { resolveRelay } from "./comms-relay";
import { buildCommEnvelope, type CommEnvelope } from "./comms-envelope";
import { SIGNATURE_HEADER, signWebhookBody, TIMESTAMP_HEADER } from "./ats-webhook";
import { logComms } from "./logger";

// Direction B — outbound communications. Pluggable channel, mirroring the deterministic-
// fallback pattern: a durable local OUTBOX by default (always works, also serves as the
// audit log), or a real HTTP relay when COMMS_WEBHOOK_URL is set (wire to SendGrid / a
// mail relay / Zapier / an ATS). Every message is recorded either way.
//
// DELIVERY CONTRACT (statuses defined once in comms-status.ts; full write-up in
// docs/features/comms/README.md):
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

// TENANT CONTRACT (comms-tenancy-pair): `ref` (a pipeline entry id) is the primary
// tenant source — recordOutbox derives the owning team from the entry, so nearly no
// dispatcher threads a workspace. `workspaceId` is the fallback for an ENTRY-LESS comm
// (a KO decline is dispatched before any entry exists) whose caller nonetheless knows
// the team: without it the row lands in the DEFAULT workspace's Comms Center and is
// invisible to the team that actually owns the lead. It NEVER overrides an entry-derived
// tenant — it is consulted only when `ref` resolves to no entry. Not part of the wire
// envelope: it's kp-internal bookkeeping, not something a relay should see.
export type OutboundMessage = { to: string; subject: string; body: string; kind: string; ref?: string; workspaceId?: string | null };

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
    return recordOutbox({
      recipient: msg.to,
      subject: msg.subject,
      body: msg.body,
      kind: msg.kind,
      channel: this.name,
      status: "queued",
      ref: msg.ref,
      workspaceId: msg.workspaceId,
    });
  }
}

// Real channel: POST the message to a configured relay. Transient failures (network /
// 429 / 5xx) are retried with bounded exponential backoff; a non-retryable response, or
// exhausting the retries, dead-letters the message (status `failed`) and raises a loud
// alert — a dropped offer/rejection must never look as benign as a local `queued` row.
//
// E8 — the wire payload is the versioned kp.comm.v1 envelope (comms-envelope.ts,
// documented in docs/features/comms/outbound-export.md): the flat legacy fields verbatim, plus
// candidate/job/stage context enriched from the pipeline entry the message
// references — so a relay can map kp → any ATS without calling back.
class WebhookChannel implements CommsChannel {
  readonly name = "webhook";
  constructor(
    private readonly url: string,
    // Optional HMAC signing secret (UI-configured relays): when set, the exact
    // serialized body is signed into the shared x-kp-signature header — same
    // scheme (and verify helper) as the ATS webhook, so one receiver can check both.
    private readonly secret: string | null = null
  ) {}

  async send(msg: OutboundMessage): Promise<OutboxEntry> {
    // `ref` is the pipeline entry id for every pipeline dispatcher; dev-case and
    // slot refs simply miss and ship null context (the flat fields still deliver).
    // The tenant is DERIVED FROM `ref`, exactly as recordOutbox files the row
    // (outboxWorkspaceForRef): `ref` is the primary tenant source and `workspaceId`
    // is only the entry-less fallback, which nearly no dispatcher threads. Scoping
    // this read to `msg.workspaceId` instead therefore fell back to the DEFAULT team
    // for every ordinary candidate comm, so on any other workspace the lookup missed
    // and EVERY relayed message shipped an envelope with no candidate, role or stage —
    // leaving the receiving ATS unable to map it back to a person.
    const envelope = buildCommEnvelope(
      msg,
      msg.ref ? getPipelineEntry(msg.ref, getEntryWorkspace(msg.ref)) : null,
      new Date().toISOString()
    );
    const { status, attempts, detail } = await this.deliver(envelope);
    if (status === "failed") await this.alertDeadLetter(msg, attempts, detail);
    // failure-truth-everywhere: `detail` is the precise reason this attempt died
    // ("http 503", "getaddrinfo ENOTFOUND …"). It used to be spent entirely on the
    // dead-letter alert and then dropped, so the row the recruiter actually looks at
    // said "failed" and nothing more. It now rides the row (recordOutbox keeps it only
    // for `failed`), which is what the Comms Center reads.
    return recordOutbox({
      recipient: msg.to,
      subject: msg.subject,
      body: msg.body,
      kind: msg.kind,
      channel: this.name,
      status,
      ref: msg.ref,
      failureDetail: detail,
      workspaceId: msg.workspaceId,
    });
  }

  // Attempt delivery with bounded retry. Returns the terminal status plus how many
  // attempts ran and the last failure detail (for the dead-letter alert / audit).
  private async deliver(envelope: CommEnvelope): Promise<{ status: OutboxStatus; attempts: number; detail: string }> {
    let detail = "";
    const body = JSON.stringify(envelope);
    // The envelope's own instant rides as X-Kp-Timestamp and is signed with the body,
    // so a captured relay delivery cannot be replayed later under its own signature.
    // The retry loop below reuses this instant deliberately: it is the same delivery,
    // and the bounded ladder finishes far inside the receiver's tolerance window.
    const headers: Record<string, string> = { "Content-Type": "application/json", [TIMESTAMP_HEADER]: envelope.sentAt };
    if (this.secret) headers[SIGNATURE_HEADER] = signWebhookBody(this.secret, body, envelope.sentAt);
    for (let attempt = 1; attempt <= COMMS_RELAY_RETRY.maxAttempts; attempt++) {
      try {
        const r = await fetch(this.url, { method: "POST", headers, body });
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
  // Capability resolved through the shared resolver (comms-relay.ts: env →
  // stored config → nothing) so channel selection and every UI "sent" claim key
  // off the SAME bit.
  const relay = resolveRelay();
  return relay ? new WebhookChannel(relay.url, relay.secret) : new OutboxChannel();
}

/** Convenience: dispatch one message through the active channel. */
export async function sendComm(msg: OutboundMessage): Promise<OutboxEntry> {
  return getCommsChannel().send(msg);
}
