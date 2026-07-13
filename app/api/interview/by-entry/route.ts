import { NextRequest, NextResponse } from "next/server";
import { getEntryWorkspace, getPipelineEntry, interviewStatusByEntries, latestInterviewByEntry } from "@/app/_lib/db";
import { consentWithholdsPii, redactTranscriptForConsent } from "@/app/_lib/consent";
import { safeJsonError } from "@/app/_lib/api-response";
import { parseEntriesParam } from "@/app/_lib/entries-param";


// GET ?entries=a,b,c → { status: { <entryId>: { sessionId, status, hasTranscript, endedAt } } }
// GET ?entry=<id>    → { session } (the latest interview session for one entry, with transcript + scorecard)
export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const entry = sp.get("entry");
    if (entry) {
      const session = latestInterviewByEntry(entry);
      // Read-time consent gate (bug-ui-scan-2026-07-09 privacy-consent-provenance #3):
      // the moment consent has EXPIRED (or the entry is anonymized), withhold the verbatim
      // transcript + scorecard SYNCHRONOUSLY — don't keep serving the candidate's own spoken
      // answers until the deferred anonymize sweep happens to run. Resolve the entry's tenant
      // first (sessions are keyed by entry_id globally) so the consent snapshot is read.
      if (session) {
        const e = getPipelineEntry(entry, getEntryWorkspace(entry));
        if (
          e &&
          consentWithholdsPii({ givenAt: e.consentGivenAt, expiresAt: e.consentExpiresAt, anonymizedAt: e.anonymizedAt })
        ) {
          return NextResponse.json({ session: redactTranscriptForConsent(session) });
        }
      }
      return NextResponse.json({ session });
    }
    // Bounded + de-duped at the trust boundary so a crafted/huge `entries` list
    // can't blow the SQLite variable limit or amplify the IN query (idea-191ccc0c).
    const entries = parseEntriesParam(sp.get("entries"));
    return NextResponse.json({ status: interviewStatusByEntries(entries) });
  } catch (error) {
    return safeJsonError(error, "api:interview:by-entry", "INTERVIEW_LOOKUP_FAILED");
  }
}
