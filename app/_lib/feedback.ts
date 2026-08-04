// Recruiter feedback door — the pure validation half (the candidate-nps.ts /
// candidate-nps-store.ts split: rules here, SQL in feedback-store.ts).
//
// A submission is validated, never coerced: a blank message is rejected rather
// than stored empty, an over-limit message is rejected rather than silently
// truncated (the sender should know their text did not fit), and a malformed
// reply email is rejected rather than stored as an undeliverable string.

export const FEEDBACK_MESSAGE_MAX = 2000;
export const FEEDBACK_EMAIL_MAX = 254; // RFC 5321 path ceiling
export const FEEDBACK_ROUTE_MAX = 300;

export type FeedbackSubmission = {
  message: string;
  /** Optional reply-to address ("" and whitespace normalize to null). */
  email: string | null;
  /** The in-app route the dialog was opened from ("/..."), display-only. */
  route: string | null;
};

export type FeedbackParseResult =
  | { ok: true; value: FeedbackSubmission }
  | { ok: false; reason: string };

/** Minimal deliverability shape — one "@" with something on both sides. A full
 *  RFC parse buys nothing here; the address is a courtesy reply channel. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function parseFeedbackSubmission(body: unknown): FeedbackParseResult {
  const b = (body ?? {}) as { message?: unknown; email?: unknown; route?: unknown };
  if (typeof b.message !== "string" || b.message.trim() === "") {
    return { ok: false, reason: "A message is required." };
  }
  const message = b.message.trim();
  if (message.length > FEEDBACK_MESSAGE_MAX) {
    return { ok: false, reason: `Message is too long (max ${FEEDBACK_MESSAGE_MAX} characters).` };
  }

  let email: string | null = null;
  if (b.email != null && b.email !== "") {
    if (typeof b.email !== "string") return { ok: false, reason: "Invalid email." };
    const trimmed = b.email.trim();
    if (trimmed !== "") {
      if (trimmed.length > FEEDBACK_EMAIL_MAX || !EMAIL_SHAPE.test(trimmed)) {
        return { ok: false, reason: "Invalid email." };
      }
      email = trimmed;
    }
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

  return { ok: true, value: { message, email, route } };
}
