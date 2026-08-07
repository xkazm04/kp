import { NextRequest, NextResponse } from "next/server";
import { candidateOnboardingView, submitCandidateIntake } from "@/app/_lib/onboarding-candidate";
import { jsonOk, safeJsonError } from "@/app/_lib/api-response";
import { clientIpFrom, rateLimit, RATE_LIMITED_ERROR } from "@/app/_lib/rate-limit";


// Candidate-facing onboarding hand-off (offers #5, token-gated by the ACCEPTED offer's
// token). GET renders the pre-boarding questionnaire view for /onboarding/[token]; POST
// saves the candidate's answers against their onboarding run. Accept now lands on a
// concrete next step instead of a dead-end "our People team will be in touch".
export async function GET(_request: NextRequest, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const view = candidateOnboardingView(token);
  if (!view) return NextResponse.json({ error: "This onboarding link is not valid." }, { status: 404 });
  return jsonOk({ onboarding: view });
}

export async function POST(request: NextRequest, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  try {
    // Side-effect-bearing public endpoint — throttle per caller+token (mirrors /offer).
    if (!rateLimit(`onboarding:${clientIpFrom(request.headers)}:${token}`, { limit: 10, windowMs: 60_000 })) {
      return NextResponse.json({ error: RATE_LIMITED_ERROR }, { status: 429 });
    }
    const body = (await request.json().catch(() => ({}))) as { answers?: Record<string, unknown> };
    const answers = body.answers && typeof body.answers === "object" ? body.answers : {};
    const result = submitCandidateIntake(token, answers);
    // bug-ui-scan-2026-07-09 (offers-onboarding #2): an all-blank submit is a client
    // validation gap, not an invalid link — 400 so it isn't mislabeled 404, and (the
    // real fix) no intake row was written that would suppress the pre-boarding reminder.
    if (!result.ok && result.empty) {
      return NextResponse.json({ error: "Please share at least one detail before submitting." }, { status: 400 });
    }
    // Only an accepted offer has an onboarding hand-off; anything else is not-found.
    if (!result.ok) return NextResponse.json({ error: "This onboarding link is not valid." }, { status: 404 });
    return jsonOk(result);
  } catch (error) {
    return safeJsonError(error, "api:onboarding:intake", "ONBOARDING_FAILED");
  }
}
