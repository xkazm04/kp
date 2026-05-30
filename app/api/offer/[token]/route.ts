import { NextRequest, NextResponse } from "next/server";
import { offerView, respondToOffer } from "@/app/_lib/offer-finalize";

export const runtime = "nodejs";

// Candidate-facing offer response (token-gated). GET renders the summary for the
// public /offer/[token] page; POST captures accept/decline and runs the terminal
// transitions (accept -> Hired + onboarding; decline -> closed).
export async function GET(_request: NextRequest, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const view = offerView(token);
  if (!view) return NextResponse.json({ error: "This offer link is not valid." }, { status: 404 });
  return NextResponse.json({ offer: view });
}

export async function POST(request: NextRequest, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  try {
    const body = (await request.json()) as { response?: string };
    const response = body.response;
    if (response !== "accept" && response !== "decline") {
      return NextResponse.json({ error: "Response must be 'accept' or 'decline'." }, { status: 400 });
    }
    const result = await respondToOffer(token, response);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 404 });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not record your response.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
