// The offer door's accept/decline state machine — the PURE half.
//
// OfferClient's `respond()` mixed three things: the fetch, the decision about what
// the answer means, and the setState calls. Only the middle one carries product
// judgement (a 410 is a definite ending, a 500 is retryable, a 200 that names no
// status is a failure rather than a silent success) and it is the half a client
// component cannot test. It lives here so offer-client-logic.test.ts can.

/** What the candidate's card must become after one accept/decline round-trip.
 *  `settled` is terminal — the card swaps and the buttons are gone. `failed`
 *  keeps the card and re-enables the buttons, showing `errors.<code>` in the
 *  reader's language (or the page's own respond-failed copy when there is no
 *  code — the server's English prose is never rendered). */
export type OfferResponseOutcome =
  | { kind: "settled"; status: "accepted" | "declined" | "expired" }
  | { kind: "failed"; code: string | null };

/** Narrow an unknown JSON body to the two fields this decision reads. */
function fieldsOf(body: unknown): { status?: unknown; code?: unknown } {
  return typeof body === "object" && body !== null ? (body as { status?: unknown; code?: unknown }) : {};
}

/**
 * Classify one POST /api/offer/[token] answer.
 *
 * 410 is the ONE status with its own meaning: the offer lapsed past its deadline,
 * which is a definite dead end and not something a retry can fix — the card swaps
 * to `expired` rather than showing an inline error over live-looking buttons.
 */
export function classifyOfferResponse(httpStatus: number, body: unknown): OfferResponseOutcome {
  if (httpStatus === 410) return { kind: "settled", status: "expired" };
  const { status, code } = fieldsOf(body);
  if (httpStatus < 200 || httpStatus >= 300) {
    return { kind: "failed", code: typeof code === "string" && code ? code : null };
  }
  if (status === "accepted" || status === "declined") return { kind: "settled", status };
  // A 2xx that names no recorded outcome cannot be reported as one: swapping to a
  // terminal card here would tell a candidate their answer landed on the strength
  // of a truncated body.
  return { kind: "failed", code: null };
}

/** May another accept/decline be sent? Both responses are irreversible, so a
 *  second one is gated on the first having settled — the component's `pending`
 *  flag is the whole guard and it is asserted rather than assumed. */
export function offerRespondAllowed(pending: "accept" | "decline" | null): boolean {
  return pending === null;
}
