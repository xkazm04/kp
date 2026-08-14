import { NextResponse } from "next/server";
import { getActiveRegimeId } from "@/app/_lib/decision-config-store";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { consentRetentionMonths } from "@/app/_lib/consent";


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
  // TENANCY — read the regime for the CALLER's workspace. Bare, getActiveRegimeId()
  // always answered for the default workspace: a team that had set its jurisdiction
  // to `us` still saw "EU equal-treatment directives / processed under GDPR" on its
  // Decisions compliance card, and shipped that same wrong law to its candidates.
  //
  // This closes the SESSION-BEARING half only, and deliberately so. The recruiter
  // Decisions card (decisionsComplianceState.ts) carries a cookie and is now
  // correct; an anonymous candidate rendering AiDisclosure has none, so
  // currentWorkspace() falls back to the default — the shipped behavior, unchanged,
  // not a new leak. The durable fix for that half is the one AiDisclosure.tsx
  // documents in its KNOWN GAP: resolve the regime SERVER-side from the capability
  // token's workspace and pass it in as a prop, because a client fetch cannot prove
  // which tenant's job the candidate is looking at. Widening this route's trust
  // (e.g. a caller-supplied workspace id) would let anyone enumerate any team's
  // legal posture, so it stays off the table.
  //
  // consentRetentionMonths() stays global on purpose: it derives from the
  // KP_CONSENT_TTL_DAYS env knob, which is a deployment-level setting with no
  // per-workspace tier to read.
  return NextResponse.json({
    jurisdiction: getActiveRegimeId(await currentWorkspace()),
    consentRetentionMonths: consentRetentionMonths(),
  });
}
