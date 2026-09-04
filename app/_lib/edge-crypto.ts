// The two cryptographic contracts between a local install and its edge
// (docs/concepts/local-first-edge.md §2). Pure WebCrypto + node:crypto, no
// dependency, and deliberately in its own module so both halves of each contract
// are readable in one screen — the Worker implements the mirror image of exactly
// this file, and a drift between them is a silent data-loss bug.
//
//   1. AUTHENTICITY (both directions) — an HMAC-SHA256 signature over
//      `<timestamp>.<body>`, sent as `x-kp-signature` + `x-kp-timestamp`. Identical
//      scheme to the outbound comms relay and the ATS webhook, so an operator who
//      has verified one has verified all three. The timestamp bounds replay to a
//      five-minute window, and INSIDE that window the edge spends each signature
//      exactly once: `edge/schema.sql` carries a `nonces` table, every signed door
//      claims `sha256(signature)` through it, and a second presentation is answered
//      409. That used to be aspirational -- a captured `POST /ack {upto}` replayed for
//      five minutes and DELETES queued events -- and edge-drain.test.ts now pins it.
//
//   2. CONFIDENTIALITY (edge → local only) — the edge must be able to ACCEPT a
//      candidate's data without being able to READ it. So local generates an
//      RSA-OAEP keypair, publishes only the public half, and the Worker seals each
//      event body with a fresh AES-256-GCM key wrapped to that public key. The
//      private half never leaves this machine (encrypted at rest under KP_SECRET,
//      like every other stored credential).
//
// WHAT THIS DOES NOT DO, stated plainly because the threat model depends on it: the
// edge still SEES a payload in memory for the moment it seals it, and it still sees
// routing metadata (which receiver token, how big, when). Sealing means a dump of
// the edge's storage yields ciphertext, not that the edge is trustless.

import { createHmac, timingSafeEqual, webcrypto } from "node:crypto";

const crypto = webcrypto as unknown as Crypto;

/** How far apart a signed request's clock may be from ours. Wide enough for a
 *  laptop that has been asleep and a Worker at the other end of the planet, tight
 *  enough that a captured envelope is not replayable tomorrow. */
export const EDGE_SIGNATURE_SKEW_MS = 5 * 60_000;

/** `<timestamp>.<body>` — the exact bytes both sides sign. Naming it here is the
 *  point: an implementation that signs the body alone is compatible right up until
 *  someone replays it. */
export function edgeSigningPayload(timestamp: string, body: string): string {
  return `${timestamp}.${body}`;
}

export function signEdgePayload(secret: string, timestamp: string, body: string): string {
  return createHmac("sha256", secret).update(edgeSigningPayload(timestamp, body)).digest("hex");
}

/** Constant-time verification, including the freshness window. Returns false for
 *  anything malformed rather than throwing — a caller must not have to distinguish
 *  "forged" from "garbled" to refuse it. */
export function verifyEdgeSignature(
  secret: string,
  timestamp: string | null,
  body: string,
  signature: string | null,
  nowMs: number = Date.now()
): boolean {
  if (!timestamp || !signature) return false;
  const at = Number(timestamp);
  if (!Number.isFinite(at) || Math.abs(nowMs - at) > EDGE_SIGNATURE_SKEW_MS) return false;
  const expected = Buffer.from(signEdgePayload(secret, timestamp, body), "utf8");
  const got = Buffer.from(signature, "utf8");
  if (expected.length !== got.length) return false;
  return timingSafeEqual(expected, got);
}

// ---- Sealed event bodies ----------------------------------------------------

/** The wire shape of a sealed body. `v` is present so a future scheme change is a
 *  version bump rather than an ambiguous parse. */
export type SealedBody = { v: 1; key: string; iv: string; data: string };

export function isSealedBody(value: unknown): value is SealedBody {
  const b = value as SealedBody | null;
  return !!b && b.v === 1 && typeof b.key === "string" && typeof b.iv === "string" && typeof b.data === "string";
}

const RSA_PARAMS = { name: "RSA-OAEP", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" } as const;

/** Generate the install's sealing keypair. Returns both halves as JWK JSON: the
 *  public one is published to the edge, the private one is stored encrypted. */
export async function generateEdgeKeypair(): Promise<{ publicJwk: string; privateJwk: string }> {
  const pair = await crypto.subtle.generateKey(RSA_PARAMS, true, ["encrypt", "decrypt"]);
  const [pub, priv] = await Promise.all([
    crypto.subtle.exportKey("jwk", pair.publicKey),
    crypto.subtle.exportKey("jwk", pair.privateKey),
  ]);
  return { publicJwk: JSON.stringify(pub), privateJwk: JSON.stringify(priv) };
}

/** Open a sealed body. Throws on any failure — an unopenable event must NOT be
 *  acked (it would be gone forever); the drain records the error and holds it. */
export async function unsealBody(privateJwk: string, sealed: SealedBody): Promise<string> {
  const privateKey = await crypto.subtle.importKey("jwk", JSON.parse(privateJwk) as JsonWebKey, RSA_PARAMS, false, ["decrypt"]);
  const rawKey = await crypto.subtle.decrypt({ name: "RSA-OAEP" }, privateKey, Buffer.from(sealed.key, "base64"));
  const aesKey = await crypto.subtle.importKey("raw", rawKey, { name: "AES-GCM" }, false, ["decrypt"]);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: Buffer.from(sealed.iv, "base64") },
    aesKey,
    Buffer.from(sealed.data, "base64")
  );
  return Buffer.from(plain).toString("utf8");
}

/** The sealing half. Local never needs it in production — the Worker does — but it
 *  exists here so the round trip is unit-testable against the real key material
 *  rather than against a mock of it. */
export async function sealBody(publicJwk: string, plaintext: string): Promise<SealedBody> {
  const publicKey = await crypto.subtle.importKey("jwk", JSON.parse(publicJwk) as JsonWebKey, RSA_PARAMS, false, ["encrypt"]);
  const aesKey = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, aesKey, Buffer.from(plaintext, "utf8"));
  const rawKey = await crypto.subtle.exportKey("raw", aesKey);
  const wrapped = await crypto.subtle.encrypt({ name: "RSA-OAEP" }, publicKey, rawKey);
  return {
    v: 1,
    key: Buffer.from(wrapped).toString("base64"),
    iv: Buffer.from(iv).toString("base64"),
    data: Buffer.from(data).toString("base64"),
  };
}
