import { getActiveRegimeId } from "./decision-config-store";
import { consentRetentionMonths } from "./consent";
import { DEFAULT_REGIME_ID, type DisclosureCompliance } from "./compliance-regimes";

// SERVER-side resolver for the candidate-facing AI disclosure's two legal facts.
//
// WHY THIS EXISTS. `app/_components/AiDisclosure.tsx` is a client component on
// ~8 public candidate surfaces, and it used to self-resolve both facts by
// fetching GET /api/compliance from the browser. That path was wrong twice, both
// times in the UNDER-disclosure direction:
//
//   1. /api/compliance is NOT on the public allow-list (app/_lib/auth/
//      public-routes.ts), so on any deployment with KP_OPERATOR_PASSWORD set the
//      fail-closed proxy 401s it and no candidate ever received the real values —
//      the pre-fetch default (EU / 12 months) was the FINAL state.
//   2. The route resolves the regime for the CALLER's workspace, and an anonymous
//      candidate has no session, so it answered for the default workspace
//      regardless of whose job the candidate was looking at.
//
// A candidate surface knows its tenant because it already resolved a token, an
// invite or a job server-side. So the durable fix is this: resolve here, from
// THAT workspace, and hand the values to the component as props. The route stays
// gated on purpose — widening its trust with a caller-supplied workspace id would
// let anyone enumerate any team's legal posture, which is a worse defect than the
// one it would fix (see the comment in app/api/compliance/route.ts).
//
// Never throws: a locked / corrupt decision-config store must not take down the
// page the disclosure sits on. It degrades to the shipped EU default — the same
// last-resort fallback the component keeps — and says so in the log, because an
// operator whose workspace is configured `us` would want to know its regime went
// dark rather than read GDPR framing on their candidates' pages.
export function disclosureComplianceFor(workspaceId: string | null | undefined): DisclosureCompliance {
  // The retention window is a DEPLOYMENT-level knob (KP_CONSENT_TTL_DAYS) with no
  // per-workspace tier to read, so it is global by construction — but it is still
  // derived, never the hardcoded "12 months" the copy used to carry.
  const retentionMonths = consentRetentionMonths();
  try {
    return { regimeId: getActiveRegimeId(workspaceId ?? undefined), retentionMonths };
  } catch (error) {
    console.warn(
      `[compliance-disclosure] could not read the active regime for workspace ${workspaceId ?? "(default)"} — ` +
        `the candidate disclosure falls back to the ${DEFAULT_REGIME_ID.toUpperCase()} default, which may be the wrong law ` +
        `for this workspace: ${error instanceof Error ? error.message : String(error)}`
    );
    return { regimeId: DEFAULT_REGIME_ID, retentionMonths };
  }
}
