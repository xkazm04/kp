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
/** When the delivery was signed, as the SAME ISO-8601 instant the envelope carries in
 *  `sentAt`. A receiver can therefore check the header before parsing the body, and
 *  assert the two agree afterwards.
 *
 *  WHY IT EXISTS. The signature covered the body ALONE, so a signature stayed valid
 *  forever: anyone who captured one delivery (a proxy log, a misconfigured receiver, a
 *  history of retries) could replay that exact bytes-plus-header pair at any later moment
 *  and it verified. Binding the instant INTO the HMAC input is what lets a receiver
 *  reject a replay — the timestamp cannot be edited without invalidating the signature,
 *  and a signature whose timestamp is outside the tolerance window is refused. Same
 *  construction as Stripe's `Stripe-Signature`, reduced to the one scheme we send. */
export const TIMESTAMP_HEADER = "x-kp-timestamp";
/** How far a delivery's timestamp may sit from the receiver's clock and still be
 *  accepted: FIVE MINUTES either side. It has to cover honest clock skew between two
 *  machines plus the delivery's own flight time, and stay far below the retry ladder's
 *  reach (six attempts, exponential from one minute) so a legitimate retry re-signs
 *  rather than arriving stale. `deliver()` signs at send time, and each retry builds a
 *  fresh envelope, so every attempt carries its own current instant.
 *
 *  Symmetric on purpose: a receiver whose clock runs ahead must not reject deliveries
 *  from a correct sender, and "the future" is not a safer direction than "the past". */
export const SIGNATURE_TOLERANCE_SECONDS = 300;

export type WebhookEnvelope = {
  event: AtsEventType;
  sentAt: string;
  schemaVersion: string;
  data: AtsCandidateRecord | { ping: true };
};

/** Assemble the envelope. Caller supplies `sentAt` so this stays pure/testable. */
export function buildEnvelope(event: AtsEventType, data: AtsCandidateRecord | { ping: true }, sentAt: string): WebhookEnvelope {
  return { event, sentAt, schemaVersion: ATS_SCHEMA_VERSION, data };
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
