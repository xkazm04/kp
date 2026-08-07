import { NextRequest, NextResponse } from "next/server";
import { offerView, respondToOffer } from "@/app/_lib/offer-finalize";
import { jsonOk, jsonRefusal, safeJsonError } from "@/app/_lib/api-response";
import { clientIpFrom, rateLimit, RATE_LIMITED_ERROR } from "@/app/_lib/rate-limit";


// Candidate-facing offer response (token-gated). GET renders the summary for the
// public /offer/[token] page; POST captures accept/decline and runs the terminal
// transitions (accept -> Hired + onboarding; decline -> closed).
export async function GET(_request: NextRequest, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const view = offerView(token);
  if (!view) return NextResponse.json({ error: "This offer link is not valid." }, { status: 404 });
  return jsonOk({ offer: view });
}

export async function POST(request: NextRequest, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  try {
    // Side-effect-bearing public endpoint (accept fires onboarding dispatch)
    // — throttle per caller+token (idea-3e49abaf).
    if (!rateLimit(`offer:${clientIpFrom(request.headers)}:${token}`, { limit: 10, windowMs: 60_000 })) {
      return NextResponse.json({ error: RATE_LIMITED_ERROR }, { status: 429 });
    }
    const body = (await request.json()) as { response?: string };
    const response = body.response;
    if (response !== "accept" && response !== "decline") {
      return NextResponse.json({ error: "Response must be 'accept' or 'decline'." }, { status: 400 });
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
