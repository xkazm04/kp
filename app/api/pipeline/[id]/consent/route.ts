import { NextRequest, NextResponse } from "next/server";
import { getPipelineEntry, listConsentEvents } from "@/app/_lib/db/pipeline";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { consentStatus } from "@/app/_lib/consent";
import { safeJsonError } from "@/app/_lib/api-response";


// Recruiter-facing GDPR consent snapshot + audit trail for one entry — backs the
// candidate drawer's "Data & consent" section. Internal route (the board is behind
// auth), so it returns the dated consent fields + the computed lifecycle status +
// the full append-only event history. The erasure capability token is never
// exposed (it lives only in the candidate-facing footer).
//
// TENANCY: both store reads take the SESSION's workspace, resolved once — the same
// shape as the sibling /api/pipeline/[id]/timeline. Left bare they fell back to the
// DEFAULT workspace, so on any other team `getPipelineEntry(id)` matched no row and
// the drawer answered 404 "Pipeline entry not found." for EVERY candidate: the whole
// "Data & consent" panel was dead, not merely wrong. Reading the events under the
// same resolved id also means an entry can never be shown beside another tenant's
// audit trail.
export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const workspaceId = await currentWorkspace();
    const entry = getPipelineEntry(id, workspaceId);
    if (!entry) return NextResponse.json({ error: "Pipeline entry not found." }, { status: 404 });
    return NextResponse.json({
      consent: {
        givenAt: entry.consentGivenAt,
        expiresAt: entry.consentExpiresAt,
        source: entry.consentSource,
        anonymizedAt: entry.anonymizedAt,
        status: consentStatus(
          { givenAt: entry.consentGivenAt, expiresAt: entry.consentExpiresAt, anonymizedAt: entry.anonymizedAt },
          Date.now()
        ),
      },
      events: listConsentEvents(id, workspaceId),
    });
  } catch (error) {
    return safeJsonError(error, "api:pipeline:consent", "CONSENT_LOOKUP_FAILED");
  }
}
