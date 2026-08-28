import { NextRequest, NextResponse } from "next/server";
import { interviewStatusByEntries, latestInterviewByEntry } from "@/app/_lib/db/interviews";
import { findEntryByDevSubmission, getEntryWorkspace, getPipelineEntry } from "@/app/_lib/db/pipeline";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { consentWithholdsPii, redactTranscriptForConsent } from "@/app/_lib/consent";
import { safeJsonError } from "@/app/_lib/api-response";
import { parseEntriesParam } from "@/app/_lib/entries-param";


// GET ?entries=a,b,c   → { status: { <entryId>: { sessionId, status, hasTranscript, endedAt } } }
// GET ?entry=<id>      → { session } (the latest interview session for one entry, with transcript + scorecard)
// GET ?submission=<id> → { session, entryId } — the SAME read reached from the assignment
//                        side, for a reviewer holding a submission id and no entry id.
export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    // ONE THREAD (gap 4) — the reverse link, and deliberately NOT a new column or a
    // new session lookup: `pipeline_entries.dev_submission_id` already points from the
    // entry at the submission, and `interview_sessions.entry_id` already points from
    // the session at the entry, so "the screen for this submission" is those two
    // existing links composed. A `dev_submission_id` on `interview_sessions` would be
    // a THIRD statement of the same fact, free to disagree with the other two the
    // moment a promote backfills onto an entry the candidate already had.
    //
    // Tenant comes from the SESSION's workspace here (a recruiter console read), not
    // from the entry: the submission id is globally unique, so an unscoped lookup
    // would answer another team's board row.
    const submission = sp.get("submission");
    if (submission) {
      const linked = findEntryByDevSubmission(submission, await currentWorkspace());
      // Never promoted yet ⇒ no entry, therefore no screen. An honest empty answer,
      // not a 404: "this candidate has no voice screen" is exactly what the caller
      // asked, and the eval surface renders its "Start voice screen" affordance on it.
      if (!linked) return NextResponse.json({ session: null, entryId: null });
      const session = latestInterviewByEntry(linked.id);
      if (
        session &&
        consentWithholdsPii({
          givenAt: linked.consentGivenAt,
          expiresAt: linked.consentExpiresAt,
          anonymizedAt: linked.anonymizedAt,
        })
      ) {
        return NextResponse.json({ session: redactTranscriptForConsent(session), entryId: linked.id });
      }
      return NextResponse.json({ session, entryId: linked.id });
    }
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
