import { NextRequest, NextResponse } from "next/server";
import { getPipelineEntry, listConsentEvents } from "@/app/_lib/db";
import { consentStatus } from "@/app/_lib/consent";
import { safeJsonError } from "@/app/_lib/api-response";

export const runtime = "nodejs";

// Recruiter-facing GDPR consent snapshot + audit trail for one entry — backs the
// candidate drawer's "Data & consent" section. Internal route (the board is behind
// auth), so it returns the dated consent fields + the computed lifecycle status +
// the full append-only event history. The erasure capability token is never
// exposed (it lives only in the candidate-facing footer).
export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const entry = getPipelineEntry(id);
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
      events: listConsentEvents(id),
    });
  } catch (error) {
    return safeJsonError(error, "api:pipeline:consent", "CONSENT_LOOKUP_FAILED");
  }
}
