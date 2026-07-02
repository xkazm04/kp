import { NextResponse } from "next/server";
import { getActiveRegimeId } from "@/app/_lib/decision-config-store";
import { consentRetentionMonths } from "@/app/_lib/consent";

export const runtime = "nodejs";

// P1-1 — the workspace's active compliance jurisdiction, read by the public
// candidate-facing AiDisclosure (a client component that can't reach the DB) so
// the transparency note names the right legal framework. Also carries the
// EFFECTIVE consent-retention window (derived from KP_CONSENT_TTL_DAYS) so the
// candidate-facing consent sentence and the compliance posture always state the
// enforced number instead of a hardcoded "12 months" (REC-08/capst-l1-005).
// Returns only the regime id + a duration — no candidate data — so it's safe to
// expose unauthenticated, like the rest of the public apply/offer/interview
// token surfaces that render the disclosure.
export async function GET() {
  return NextResponse.json({
    jurisdiction: getActiveRegimeId(),
    consentRetentionMonths: consentRetentionMonths(),
  });
}
