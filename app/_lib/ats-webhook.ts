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

/** `sha256=<hex>` HMAC of the exact JSON body string. Sign the serialized body
 *  the receiver will read, byte-for-byte — never a re-serialization. */
export function signWebhookBody(secret: string, body: string): string {
  return "sha256=" + createHmac("sha256", secret).update(body, "utf8").digest("hex");
}

/** Constant-time verification of a `sha256=…` signature against the body. Returns
 *  false (never throws) on any mismatch, including a malformed/length-mismatched
 *  header, so a receiver port of this can be used as a hard auth gate. */
export function verifyWebhookSignature(secret: string, body: string, signature: string | null | undefined): boolean {
  if (!signature) return false;
  const expected = signWebhookBody(secret, body);
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature, "utf8");
  if (a.length !== b.length) return false; // timingSafeEqual throws on length mismatch
  return timingSafeEqual(a, b);
}
