import { NextRequest } from "next/server";
import { offerView, respondToOffer } from "@/app/_lib/offer-finalize";
import { jsonOk, jsonRefusal, safeJsonError } from "@/app/_lib/api-response";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";
import { BODY_TOO_LARGE, readJsonWithLimit } from "@/app/_lib/request-body";


// The GET is not a pure read: offerView runs expireOfferIfDue, a write path, on
// every hit — and until 2026-09-01 only the POST below was throttled. The page
// now revalidates on a 60s interval plus focus, i.e. ~1 req/min per candidate;
// 60/min leaves more than an order of magnitude of headroom for focus churn and
// manual reloads, while capping what a leaked link can make the store do.
// Keyed by token AND client, like the status route.
const OFFER_VIEW_RATE_LIMIT = { limit: 60, windowMs: 60_000 };

// Candidate-facing offer response (token-gated). GET renders the summary for the
// public /offer/[token] page; POST captures accept/decline and runs the terminal
// transitions (accept -> Hired, the terminal state; decline -> closed).
export async function GET(request: NextRequest, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  if (!rateLimit(`offer-view:${clientIpFrom(request.headers)}:${token}`, OFFER_VIEW_RATE_LIMIT)) {
    return jsonRefusal("TOO_MANY_REQUESTS", 429);
  }
  const view = offerView(token);
  // Coded, not prose: this is a PUBLIC door reached from a letter written in the
  // candidate's own language, and the client renders `errors.OFFER_NOT_FOUND`
  // rather than the server's English (api-contracts.md 1.1). Same code the POST
  // has always answered a missing token with.
  if (!view) return jsonRefusal("OFFER_NOT_FOUND", 404);
  return jsonOk({ offer: view });
}

/** Hard cap on this public door's request body: one enum word (`accept` / `decline`) — 4 KB is already three orders of magnitude of slack.
 *  Enforced on the BYTES READ, not on the caller's content-length (request-body.ts). */
const MAX_OFFER_BODY_BYTES = 4 * 1024;

// The budget on the most consequential candidate action in the product: accept
// hires and fires the ATS handoff, decline closes the entry irreversibly. 10/min
// is generous for a decision a candidate makes once; keyed by token AND client
// like the GET above. NAMED rather than inline so the two limiters on this door
// read the same way and the contract test pins the definition, not a literal.
const OFFER_RESPOND_RATE_LIMIT = { limit: 10, windowMs: 60_000 };

export async function POST(request: NextRequest, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  try {
    // Side-effect-bearing public endpoint (accept hires + fires the ATS handoff)
    // — throttle per caller+token (idea-3e49abaf).
    if (!rateLimit(`offer:${clientIpFrom(request.headers)}:${token}`, OFFER_RESPOND_RATE_LIMIT)) {
      return jsonRefusal("TOO_MANY_REQUESTS", 429);
    }
    const body = await readJsonWithLimit<{ response?: string }>(request, MAX_OFFER_BODY_BYTES, {});
    if (body === BODY_TOO_LARGE) return jsonRefusal("PAYLOAD_TOO_LARGE", 413, { maxBytes: MAX_OFFER_BODY_BYTES });
    const response = body.response;
    if (response !== "accept" && response !== "decline") {
      return jsonRefusal("OFFER_RESPONSE_INVALID", 400);
    }
    const result = await respondToOffer(token, response);
    // 410 Gone for a lapsed offer (idea-29361408) — distinct from 404 not-found so
    // the page can show a definite "expired" state, not a generic error.
    if (!result.ok) return jsonRefusal(result.code, result.expired ? 410 : 404);
    return jsonOk(result);
  } catch (error) {
    return safeJsonError(error, "api:offer:respond", "OFFER_RESPOND_FAILED");
  }
}
