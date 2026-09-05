// P1-5 — the outbound webhook contract: the vendor-neutral event a connector /
// iPaaS subscribes to. Every meaningful lifecycle outcome (hire, reject, offer
// response) becomes a signed POST the customer's middleware lands in their ATS.
//
// AUTHENTICITY — the body is signed with HMAC-SHA256 over a shared secret, in the
// widely-used `sha256=<hex>` header form (GitHub/Stripe-style), so the receiver
// can verify the payload came from this workspace and wasn't tampered with in
// transit. node:crypto only — this module is server-side (never imported by the
// browser bundle); the pure record shape it carries lives in ats-record.ts.

import { createHmac, timingSafeEqual } from "node:crypto";
import { ATS_SCHEMA_VERSION, type AtsCandidateRecord } from "./ats-record.ts";

export const ATS_EVENT_TYPES = [
  "candidate.hired",
  "candidate.rejected",
  "offer.accepted",
  "offer.declined",
  "ping",
] as const;
export type AtsEventType = (typeof ATS_EVENT_TYPES)[number];

/** Subscribable events (everything except the always-allowed test `ping`). */
export const SUBSCRIBABLE_EVENTS: readonly AtsEventType[] = ATS_EVENT_TYPES.filter((e) => e !== "ping");

export function isAtsEvent(v: unknown): v is AtsEventType {
  return typeof v === "string" && (ATS_EVENT_TYPES as readonly string[]).includes(v);
}

export const SIGNATURE_HEADER = "x-kp-signature";
export const EVENT_HEADER = "x-kp-event";
/** When THIS ATTEMPT was signed — a fresh instant on every attempt, and the value the
 *  HMAC binds. A receiver checks it before parsing the body.
 *
 *  IT IS NOT the envelope's `sentAt`, and the two are deliberately different questions.
 *  `sentAt` is when the DELIVERY was created and is stable across the whole retry ladder,
 *  so a redelivery is byte-identical to the first attempt and a receiver can dedupe on
 *  the body alone. The header is when THIS attempt left, so the skew window below can do
 *  its job: freezing both would mean every retry past five minutes arrives outside the
 *  tolerance and is refused — the ladder would be signing deliveries that can never be
 *  accepted. Same split as Stripe's (`created` in the body, `t=` in the signature). On
 *  the FIRST attempt they are equal, which is why the two used to look like one value.
 *
 *  WHY IT EXISTS. The signature covered the body ALONE, so a signature stayed valid
 *  forever: anyone who captured one delivery (a proxy log, a misconfigured receiver, a
 *  history of retries) could replay that exact bytes-plus-header pair at any later moment
 *  and it verified. Binding the instant INTO the HMAC input is what lets a receiver
 *  reject a replay — the timestamp cannot be edited without invalidating the signature,
 *  and a signature whose timestamp is outside the tolerance window is refused. Same
 *  construction as Stripe's `Stripe-Signature`, reduced to the one scheme we send. */
export const TIMESTAMP_HEADER = "x-kp-timestamp";
/** The delivery's stable identity, so a receiver can make a redelivery a NO-OP.
 *  Standard `Idempotency-Key` (Stripe's spelling; the comms channel beside this one
 *  already sends a constant key per message), carrying the ledger row's id.
 *
 *  WHY IT IS THE FIX AND THE RETRY LADDER IS NOT. A receiver that accepted a POST and
 *  then timed out on the response is indistinguishable, from here, from one that never
 *  got it — so the ladder retries, correctly, and the customer's ATS gains a SECOND hire
 *  for the same candidate. Only the receiver can settle that, and only if we tell it
 *  which two requests are the same request. The ledger row id is exactly that: one row
 *  per (event, entry) attempt-set, stable across all six attempts. */
export const IDEMPOTENCY_HEADER = "idempotency-key";
/** How far a delivery's timestamp may sit from the receiver's clock and still be
 *  accepted: FIVE MINUTES either side. It has to cover honest clock skew between two
 *  machines plus the delivery's own flight time, and stay far below the retry ladder's
 *  reach (six attempts, exponential from one minute) so a legitimate retry re-signs
 *  rather than arriving stale. `deliver()` signs at send time and stamps the header with
 *  THAT instant on every attempt (the envelope's stable `sentAt` is a different field —
 *  see {@link TIMESTAMP_HEADER}), so a retry an hour into the ladder is freshly signed.
 *
 *  Symmetric on purpose: a receiver whose clock runs ahead must not reject deliveries
 *  from a correct sender, and "the future" is not a safer direction than "the past". */
export const SIGNATURE_TOLERANCE_SECONDS = 300;

export type WebhookEnvelope = {
  event: AtsEventType;
  /** When the DELIVERY was created — stable across every attempt of the retry ladder,
   *  which is what makes a redelivery byte-identical. Not the signing instant; that is
   *  {@link TIMESTAMP_HEADER}, and it moves per attempt. */
  sentAt: string;
  schemaVersion: string;
  /** The ledger row id, mirrored from {@link IDEMPOTENCY_HEADER} so a receiver that only
   *  parses bodies can dedupe too. Absent on the operator's test ping, which has no
   *  ledger row and nothing to be idempotent about. */
  idempotencyKey?: string;
  data: AtsCandidateRecord | { ping: true };
};

/** Assemble the envelope. Caller supplies `sentAt` so this stays pure/testable. */
export function buildEnvelope(
  event: AtsEventType,
  data: AtsCandidateRecord | { ping: true },
  sentAt: string,
  idempotencyKey?: string
): WebhookEnvelope {
  // The key is omitted, not null, when there is none: JSON.stringify drops an undefined
  // property, so a ping's body keeps exactly the shape receivers already parse.
  return { event, sentAt, schemaVersion: ATS_SCHEMA_VERSION, ...(idempotencyKey ? { idempotencyKey } : {}), data };
}

/** `sha256=<hex>` HMAC over the delivery. Sign the serialized body the receiver will
 *  read, byte-for-byte — never a re-serialization.
 *
 *  With `timestamp` (the value sent in {@link TIMESTAMP_HEADER}) the signed input is
 *  `<timestamp>.<body>`, so the instant is authenticated and a captured delivery cannot
 *  be replayed later under its own signature. WITHOUT it the input is the bare body —
 *  the original scheme, kept because a receiver written against it must keep verifying
 *  while senders migrate, and because two call sites outside this module still sign
 *  bodies alone (see the consumer list in docs/features/integrations/README.md).
 *
 *  The separator is a character that cannot occur in an ISO-8601 instant, so the two
 *  fields cannot be confused for one another however the body begins. */
export function signWebhookBody(secret: string, body: string, timestamp?: string): string {
  const input = timestamp === undefined ? body : `${timestamp}.${body}`;
  return "sha256=" + createHmac("sha256", secret).update(input, "utf8").digest("hex");
}

/** Constant-time verification of a `sha256=…` signature. Returns false (never throws)
 *  on any mismatch, including a malformed/length-mismatched header, so a receiver port
 *  of this can be used as a hard auth gate.
 *
 *  Pass `timestamp` (the {@link TIMESTAMP_HEADER} value) to verify a timestamped
 *  delivery. Two things then have to hold, in this order:
 *    1. the instant parses AND sits within `toleranceSeconds` of `now`
 *       ({@link SIGNATURE_TOLERANCE_SECONDS} by default), and
 *    2. the signature matches the HMAC over `<timestamp>.<body>`.
 *  The skew check comes FIRST and is deliberately not constant-time: it reveals nothing
 *  about the secret, and doing it first means a flood of replayed captures is rejected
 *  without spending an HMAC each.
 *
 *  Omit `timestamp` and this is exactly the original body-only verification — a
 *  receiver that has not migrated keeps working, and a caller CANNOT accidentally get
 *  the weaker check while believing it asked for the stronger one, because asking is
 *  what passing the timestamp means. */
export function verifyWebhookSignature(
  secret: string,
  body: string,
  signature: string | null | undefined,
  opts?: { timestamp?: string | null; nowMs?: number; toleranceSeconds?: number }
): boolean {
  if (!signature) return false;
  let timestamp: string | undefined;
  if (opts && opts.timestamp !== undefined) {
    // A caller that ASKED for the timestamped scheme and got no header must be refused,
    // not silently downgraded to the replayable one — that downgrade is the whole attack.
    if (opts.timestamp === null || opts.timestamp === "") return false;
    const at = Date.parse(opts.timestamp);
    if (!Number.isFinite(at)) return false;
    const tolerance = (opts.toleranceSeconds ?? SIGNATURE_TOLERANCE_SECONDS) * 1000;
    if (Math.abs((opts.nowMs ?? Date.now()) - at) > tolerance) return false;
    timestamp = opts.timestamp;
  }
  const expected = signWebhookBody(secret, body, timestamp);
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature, "utf8");
  if (a.length !== b.length) return false; // timingSafeEqual throws on length mismatch
  return timingSafeEqual(a, b);
}
