import { recordOutbox, type OutboxEntry } from "./db/devcase";
import { getEntryWorkspace, getPipelineEntry } from "./db/pipeline";
import { COMMS_RELAY_RETRY, isRetryableHttpStatus, type OutboxStatus } from "./comms-status";
import { resolveRelay } from "./comms-relay";
import { buildCommEnvelope, IDEMPOTENCY_HEADER, type CommEnvelope } from "./comms-envelope";
import { randomId } from "./random-id";
import { SIGNATURE_HEADER, signWebhookBody, TIMESTAMP_HEADER } from "./ats-webhook";
import { logComms } from "./logger";
import { candidateOutreachSuppression } from "./rediscovery-alert-store";
import { outreachHaltFor } from "./outreach-state-store";
import { assertPublicHttpsEndpointResolved, type HostLookup } from "./ats-egress-guard";

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
// `messageId` is the DELIVERY IDENTITY (comms-envelope.ts): one id per logical
// message, stable across the retry ladder and mirrored in the Idempotency-Key
// header. Callers normally omit it and the channel mints one per send; a caller
// that RE-SENDS an already-recorded message (the dead-letter recovery door) can
// pass the original id so the receiver recognises the repeat instead of
// delivering the offer a second time.
export type OutboundMessage = { to: string; subject: string; body: string; kind: string; ref?: string; workspaceId?: string | null; messageId?: string };

export interface CommsChannel {
  readonly name: string;
  send(msg: OutboundMessage): Promise<OutboxEntry>;
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// Per-ATTEMPT wall clock on a relay fetch. Node's fetch has NO default timeout, so a
// receiver that accepts the connection and then never answers held the handler open
// for as long as it liked — three times over, once per attempt of the retry ladder —
// while the recruiter's click sat spinning. 10s is generous for "accept this JSON and
// answer 202" and still bounds the worst case (3 × 10s + 0.6s of backoff) well inside
// what a self-hosted `next start` will tolerate (maxDuration is serverless-only).
// Overridable for tests and for a deliberately slow receiver.
export const COMMS_RELAY_TIMEOUT_MS = 10_000;
/** The probe (POST /api/comms/relay/test) answers a human waiting on a button, so it
 *  gets a tighter bound than a background delivery: a relay that cannot answer a ping
 *  in 8s has failed the thing the probe is asking about. */
export const COMMS_PROBE_TIMEOUT_MS = 8_000;

/** The effective per-attempt timeout, read at CALL time so a test (and an operator
 *  with an unusually slow relay) can override it without a rebuild. A non-positive or
 *  unparseable value falls back to the constant rather than disabling the bound —
 *  "no timeout" is the bug this closes, so it must not be reachable by a typo. */
export function relayTimeoutMs(fallback: number = COMMS_RELAY_TIMEOUT_MS): number {
  const raw = Number(process.env.KP_COMMS_RELAY_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

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
// SSRF at the DELIVERY boundary. The relay URL is operator-supplied and stored;
// `setRelayConfig` vets it with the string-level `assertPublicHttpsEndpoint`, which
// vets the literal NAME. This fetch is the moment the name is turned into an
// address, and it carries the candidate's message body (PII) plus the relay HMAC —
// so a stored `https://rebind.attacker.com` that passed the write and now answers
// 169.254.169.254 exfiltrated both. Comms run off a clock and a queue, so the gap
// between the write and this fetch is unbounded by construction: the write-time
// check is the operator's fast feedback, the resolve below is the gate. Same shared
// guard the ATS delivery boundary, the pull pass and llm-config use.
//
// The lookup is injectable so the delivery tests can drive a fixture host that no
// resolver knows. Module-scoped rather than a constructor argument because the
// channel is built inside `getCommsChannel()`, which the tests reach through
// `sendComm` — the same shape as resetSttForTests / resetTtsCacheForTests.
let relayHostLookup: HostLookup | undefined;

/** Test seam: override (or, with `undefined`, restore) the resolver the relay
 *  delivery guard uses. Never called by production code. */
export function setRelayHostLookupForTests(fn: HostLookup | undefined): void {
  relayHostLookup = fn;
}

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
    // Minted ONCE per logical message, before the first attempt, so every attempt of
    // the ladder below carries the same identity. A caller re-sending an already
    // recorded message passes its id in and the receiver sees the repeat.
    const messageId = msg.messageId?.trim() || randomId("msg");
    const envelope = buildCommEnvelope(
      msg,
      msg.ref ? getPipelineEntry(msg.ref, getEntryWorkspace(msg.ref)) : null,
      new Date().toISOString(),
      messageId
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
    // Vetted ONCE, before the ladder: a host that resolves into private space is a
    // permanent refusal, and retrying it three times only widens the window in which
    // a rebinding host answers publicly on one attempt and privately on the next.
    // A refusal here is a dead letter, not a silent drop — `send` escalates every
    // `failed` through alertDeadLetter, and the reason rides the outbox row.
    try {
      await assertPublicHttpsEndpointResolved(this.url, "relay url", relayHostLookup);
    } catch (err) {
      return {
        status: "failed",
        attempts: 0,
        detail: err instanceof Error ? err.message : "relay url is not an allowed endpoint",
      };
    }
    const body = JSON.stringify(envelope);
    // The envelope's own instant rides as X-Kp-Timestamp and is signed with the body,
    // so a captured relay delivery cannot be replayed later under its own signature.
    // The retry loop below reuses this instant deliberately: it is the same delivery,
    // and the bounded ladder finishes far inside the receiver's tolerance window.
    //
    // The Idempotency-Key rides beside them and is likewise CONSTANT across the ladder:
    // an attempt that timed out or died mid-flight may already have been accepted, so
    // without it attempt 2 delivered the same offer a second time. It is not signed
    // separately — it is a verbatim copy of the envelope's `messageId`, which IS inside
    // the signed body, so a receiver can verify it rather than trust the header.
    const headers: Record<string, string> = { "Content-Type": "application/json", [TIMESTAMP_HEADER]: envelope.sentAt };
    if (envelope.messageId) headers[IDEMPOTENCY_HEADER] = envelope.messageId;
    if (this.secret) headers[SIGNATURE_HEADER] = signWebhookBody(this.secret, body, envelope.sentAt);
    const timeoutMs = relayTimeoutMs();
    for (let attempt = 1; attempt <= COMMS_RELAY_RETRY.maxAttempts; attempt++) {
      try {
        // A FRESH signal per attempt: AbortSignal.timeout starts counting when it is
        // created, so one hoisted signal would give attempt 3 no budget at all.
        const r = await fetch(this.url, { method: "POST", headers, body, signal: AbortSignal.timeout(timeoutMs) });
        if (r.ok) return { status: "sent", attempts: attempt, detail: "" };
        detail = `http ${r.status}`;
        // Permanent (caller/config) error — retrying changes nothing, dead-letter now.
        if (!isRetryableHttpStatus(r.status)) return { status: "failed", attempts: attempt, detail };
      } catch (err) {
        // Network / DNS / abort — transient, fall through to backoff + retry. A timeout
        // gets its own sentence because the platform's is unhelpfully generic ("The
        // operation was aborted due to timeout") and the recruiter reading the
        // dead-letter row needs to know the receiver went quiet, not that kp gave up.
        detail =
          err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")
            ? `timeout after ${timeoutMs}ms`
            : err instanceof Error
              ? err.message
              : "network error";
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

// ---- THE SEND PRECONDITION -----------------------------------------------------
//
// The compliance gate (CAN-SPAM/GDPR: never write to a candidate who was ANONYMIZED
// or whose processing consent EXPIRED) lived in ONE dispatcher — `dispatchOutreach`
// in comms-dispatch.ts. Every other way into this channel skipped it: the resend door
// (`POST /api/comms/[id]/resend`), the dev-case lifecycle close, the orchestrator's
// promotion batch and the intake acknowledgement all call `sendComm` directly, so the
// gate was a property of one call path rather than of sending. That is the shape a
// gate must never have — a door that enforces it and three that do not is a gate
// nobody can reason about.
//
// It is re-asserted HERE, at the channel handoff, so the three direct callers cannot
// skip it. Re-asserting is cheap and idempotent: `dispatchOutreach` still gates first
// (it must, because it has to REPORT the reason to its caller and record the
// suppression event), and this asks the same predicate the same way.
//
// Scope, deliberately:
//   • consent + anonymization apply to EVERY candidate-facing send, because they are
//     about whether we may write to this person at all;
//   • the outreach SEQUENCE halt (they answered / a recruiter stopped it) applies only
//     to `kind: "outreach"` — it is a fact about that sequence, and a rejection or an
//     offer letter is owed to a candidate who replied, not withheld from them.
// An entry-less comm (a KO decline, a dev-case ack — `ref` names no pipeline entry)
// carries no candidate identity to consult and passes through.

/** Why this message may not be sent, or null. The ONE predicate every door shares. */
export function commsSendSuppression(msg: OutboundMessage): string | null {
  const ref = msg.ref?.trim();
  if (!ref) return null;
  let entry: ReturnType<typeof getPipelineEntry> = null;
  try {
    entry = getPipelineEntry(ref, getEntryWorkspace(ref));
  } catch (err) {
    // An unreadable pipeline store is not a licence to send: this gate is the last
    // thing standing between an erased candidate and a letter, so it fails CLOSED,
    // loudly, exactly as candidateOutreachSuppression does on its own store.
    console.error(`[comms] could not read entry "${ref}" for the send gate — refusing the send:`, err);
    return "consent_expired";
  }
  if (!entry) return null;
  const suppressed = candidateOutreachSuppression(entry.candidateId, {
    givenAt: entry.consentGivenAt,
    expiresAt: entry.consentExpiresAt,
    anonymizedAt: entry.anonymizedAt,
  });
  if (suppressed) return suppressed;
  return msg.kind === "outreach" ? outreachHaltFor(entry.id, entry.workspaceId) : null;
}

/** A send REFUSED by the precondition above — a decision, not a fault. Thrown rather
 *  than returned so the existing contract holds ("a throw means the message did NOT go
 *  out") for the callers that already treat a throw that way; `code` is the one the
 *  client renders through `useErrorMessage()`. */
export class CommsSuppressedError extends Error {
  readonly code = "COMMS_SUPPRESSED" as const;
  constructor(readonly reason: string) {
    super(`This candidate cannot be contacted (${reason}).`);
    this.name = "CommsSuppressedError";
  }
}

/** Convenience: dispatch one message through the active channel — after the ONE
 *  precondition above, which no door into this channel can skip. */
export async function sendComm(msg: OutboundMessage): Promise<OutboxEntry> {
  const suppressed = commsSendSuppression(msg);
  if (suppressed) throw new CommsSuppressedError(suppressed);
  return getCommsChannel().send(msg);
}
