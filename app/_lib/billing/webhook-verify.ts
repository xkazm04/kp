// Standard Webhooks (https://www.standardwebhooks.com) signature verification —
// the scheme Polar (and Svix-based senders generally) sign deliveries with.
// Implemented in-house on node:crypto so the hedge layer carries no vendor SDK;
// the spec is: HMAC-SHA256 over `${id}.${timestamp}.${body}` with the
// base64-decoded secret (whsec_ prefix stripped), compared against any of the
// space-separated `v1,<base64>` entries in the webhook-signature header.

import crypto from "node:crypto";

const DEFAULT_TOLERANCE_S = 300;

export class WebhookVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebhookVerificationError";
  }
}

export type WebhookHeaders = {
  id: string | null;
  timestamp: string | null;
  signature: string | null;
};

export function verifyStandardWebhook(
  rawBody: string,
  headers: WebhookHeaders,
  secret: string,
  opts: { toleranceS?: number; nowS?: number } = {}
): void {
  if (!secret || !secret.trim()) throw new WebhookVerificationError("webhook secret is not configured");
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature) {
    throw new WebhookVerificationError("missing webhook-id / webhook-timestamp / webhook-signature header");
  }

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) throw new WebhookVerificationError("webhook-timestamp is not a unix timestamp");
  const nowS = opts.nowS ?? Math.floor(Date.now() / 1000);
  const tolerance = opts.toleranceS ?? DEFAULT_TOLERANCE_S;
  if (Math.abs(nowS - ts) > tolerance) {
    throw new WebhookVerificationError(`webhook timestamp outside the ±${tolerance}s tolerance`);
  }

  // Key derivation, two conventions: a `whsec_` secret is base64 of the raw
  // key (the Standard Webhooks portable format); anything else — notably
  // Polar's `polar_whs_…` — IS the raw key, used as UTF-8 bytes. (Polar's docs
  // say to base64-encode the secret before handing it to the standardwebhooks
  // lib, which then decodes it right back — i.e. raw-string keying.)
  const key = secret.startsWith("whsec_")
    ? Buffer.from(secret.slice("whsec_".length), "base64")
    : Buffer.from(secret, "utf-8");
  if (key.length === 0) throw new WebhookVerificationError("webhook secret decodes to an empty key");
  const expected = crypto.createHmac("sha256", key).update(`${id}.${timestamp}.${rawBody}`).digest();

  // The header may carry several space-separated signatures (key rotation).
  for (const entry of signature.split(" ")) {
    const [version, sig] = entry.split(",", 2);
    if (version !== "v1" || !sig) continue;
    let candidate: Buffer;
    try {
      candidate = Buffer.from(sig, "base64");
    } catch {
      continue;
    }
    if (candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected)) {
      return;
    }
  }
  throw new WebhookVerificationError("no webhook signature matched");
}
