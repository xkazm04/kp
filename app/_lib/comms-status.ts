// Single source of truth for the outbound-comms ("Outbox") DELIVERY contract.
// The db layer types its column from this, the channels (comms.ts) write only
// these values, the DevTab Outbox UI styles by them, and the unit test locks the
// membership — so the set of valid statuses lives in exactly one place.
//
// Kept import-free so the Node unit runner (`npm run test:unit`, type-stripping)
// can load it directly; db.ts transitively imports modules the runner can't
// resolve, so the enum must NOT live there.
//
// THREE mutually-exclusive, self-describing terminal states (full rationale in
// docs/COMMS_DELIVERY.md):
//
//   queued — recorded in the local outbox because NO relay is configured
//            (COMMS_WEBHOOK_URL unset). This is a *terminal dev state*, NOT a
//            pending one: nothing dequeues, delivers, or retries it because the
//            local outbox IS the delivery target — a dev inbox + permanent audit
//            log. When offline this is the success outcome; it never transitions.
//
//   sent   — delivered to the configured relay (HTTP 2xx). Terminal success.
//
//   failed — DEAD-LETTERED. The relay was configured but delivery did not succeed:
//            either a non-retryable response (4xx other than the transient ones
//            below) or a transient failure (network / 429 / 5xx) that survived all
//            retries. Terminal and candidate-facing — a dropped offer/rejection —
//            so it is alerted loudly (see comms.ts `alertDeadLetter`), never the
//            benign-looking row it used to be.
export const OUTBOX_STATUSES = ["queued", "sent", "failed"] as const;

export type OutboxStatus = (typeof OUTBOX_STATUSES)[number];

// `failed` is the only non-success terminal state. Helper so readers (UI/alerts)
// don't string-compare the literal.
export function isDeadLettered(status: OutboxStatus): boolean {
  return status === "failed";
}

// Normalize a raw DB/string value to a canonical status. Pre-contract rows stored
// the HTTP code inline (e.g. "failed:500"); any such value — and any other
// unrecognized string — collapses to `failed`. Defaulting the unknown case to a
// NON-success state is deliberate: in an audit log of candidate comms it is safer
// to over-report a failure than to mislabel a drop as `sent`/`queued`.
export function coerceOutboxStatus(raw: string | null | undefined): OutboxStatus {
  if (raw === "queued") return "queued";
  if (raw === "sent") return "sent";
  return "failed";
}

// --- Real-relay (WebhookChannel) retry / dead-letter policy --------------------

// Bounded synchronous retry: 1 initial attempt + (maxAttempts - 1) retries, with
// exponential backoff (baseDelayMs, then 2×, …). There is no background worker or
// durable queue here, so retries happen inline within the send; once exhausted the
// message is dead-lettered (status `failed`) rather than parked in limbo.
export const COMMS_RELAY_RETRY = {
  maxAttempts: 3,
  baseDelayMs: 200,
} as const;

// Which relay HTTP responses are worth retrying. 408 Request Timeout, 425 Too
// Early, 429 Too Many Requests, and every 5xx are transient — a retry may succeed.
// All other 4xx (400/401/403/404/422 …) are caller/config errors that will fail
// identically on retry, so dead-letter immediately instead of burning attempts.
export function isRetryableHttpStatus(httpStatus: number): boolean {
  return httpStatus === 408 || httpStatus === 425 || httpStatus === 429 || httpStatus >= 500;
}
