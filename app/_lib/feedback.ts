// Recruiter feedback door — the pure validation half (the candidate-nps.ts /
// candidate-nps-store.ts split: rules here, SQL in feedback-store.ts).
//
// A submission is validated, never coerced: a blank message is rejected rather
// than stored empty, and an over-limit message is rejected rather than silently
// truncated (the sender should know their text did not fit).
//
// The reply address is NOT part of the submission. It is resolved from the signed
// -in user server-side (app/api/feedback/route.ts) and passed to the store
// separately, so a submitter cannot put someone else's address on their own
// report — the operator view on /control reads that column as "who wrote this".
// `replyEmailFrom` is the defensive normaliser for that server-derived value.

export const FEEDBACK_MESSAGE_MAX = 2000;
export const FEEDBACK_EMAIL_MAX = 254; // RFC 5321 path ceiling
export const FEEDBACK_ROUTE_MAX = 300;

export type FeedbackSubmission = {
  message: string;
  /** Reply-to address, stamped from the session user — never from the request body. */
  email: string | null;
  /** The in-app route the dialog was opened from ("/..."), display-only. */
  route: string | null;
};

/** What the CLIENT may say: everything in a submission except who wrote it. */
export type ParsedFeedback = Omit<FeedbackSubmission, "email">;

/** The refusals this validator can produce. Literal array + derived union + a
 *  runtime guard, the house shape for a closed vocabulary — and each name is a
 *  key in `REFUSAL_ERRORS` (app/_lib/api-response.ts) with an `errors.<CODE>`
 *  entry in all four catalogs, so the dialog paints the sender's OWN language
 *  instead of the English reason this module used to put on the wire. */
export const FEEDBACK_REFUSALS = ["FEEDBACK_MESSAGE_REQUIRED", "FEEDBACK_MESSAGE_TOO_LONG"] as const;

export type FeedbackRefusalCode = (typeof FEEDBACK_REFUSALS)[number];

export function isFeedbackRefusalCode(value: unknown): value is FeedbackRefusalCode {
  return typeof value === "string" && (FEEDBACK_REFUSALS as readonly string[]).includes(value);
}

export type FeedbackParseResult =
  | { ok: true; value: ParsedFeedback }
  | { ok: false; code: FeedbackRefusalCode };

/** Minimal deliverability shape — one "@" with something on both sides. A full
 *  RFC parse buys nothing here; the address is a courtesy reply channel. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Normalise a SERVER-DERIVED reply address (the session user's email) for
 *  storage. Anything unusable becomes null rather than an undeliverable string —
 *  an identity we could not read must not block someone's feedback. */
export function replyEmailFrom(email: string | null | undefined): string | null {
  if (typeof email !== "string") return null;
  const trimmed = email.trim();
  if (trimmed === "" || trimmed.length > FEEDBACK_EMAIL_MAX || !EMAIL_SHAPE.test(trimmed)) return null;
  return trimmed;
}

export function parseFeedbackSubmission(body: unknown): FeedbackParseResult {
  const b = (body ?? {}) as { message?: unknown; route?: unknown };
  if (typeof b.message !== "string" || b.message.trim() === "") {
    return { ok: false, code: "FEEDBACK_MESSAGE_REQUIRED" };
  }
  const message = b.message.trim();
  if (message.length > FEEDBACK_MESSAGE_MAX) {
    return { ok: false, code: "FEEDBACK_MESSAGE_TOO_LONG" };
  }

  // The route is client-supplied display metadata, not authority: accept only a
  // same-app path shape ("/..."), bound its length, and drop anything else to
  // null rather than rejecting the whole submission over telemetry.
  let route: string | null = null;
  if (typeof b.route === "string") {
    const trimmed = b.route.trim();
    if (trimmed.startsWith("/") && !trimmed.startsWith("//") && trimmed.length <= FEEDBACK_ROUTE_MAX) {
      route = trimmed;
    }
  }

  return { ok: true, value: { message, route } };
}
