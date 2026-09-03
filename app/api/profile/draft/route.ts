import { NextRequest, NextResponse } from "next/server";
import { jsonRefusal } from "@/app/_lib/api-response";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { ProfileDraftError, runProfileDraft } from "@/app/_lib/profile-draft-run";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";
import { getServerLocale } from "@/i18n/server";

// bug-ui-scan-2026-07-09 (pipeline-clis-script-bridges #2): this route spawns a
// Gemini child, so it needs a function budget wide enough for the child timeout
// inside runProfileDraft (55s) plus cleanup — the runner owns the child-timeout
// contract; maxDuration keeps the serverless platform from killing the function
// before the runner's finally{ cleanupWorkdir } runs.
export const maxDuration = 60;

// THROTTLE + GATE (rate-limit-contract.test.ts). This door spawns a PAID model child
// per call, and it stood open beside its own guarded twin: the UI normally drafts
// through POST /api/tasks (kind "profile_draft"), which is operator-checked upstream
// and limited at 120/10min — while this synchronous route, reaching the same
// runProfileDraft, asked for neither. On a password-gated deploy the proxy admits any
// valid session, including the anonymous one /api/demo mints, so drafting was an
// unbounded spend endpoint for anyone who could open the app. 20/10min per IP: the
// panel is one click per pasted CV blurb, so a recruiter never meets it and a scripted
// loop meets it at once.
const DRAFT_RATE_LIMIT = { limit: 20, windowMs: 10 * 60_000 };

// AI-assisted intake: free-text notes -> a routed CandidateProfileV2 draft the
// Profile editor loads for review. Does NOT persist — the recruiter edits then
// saves via POST/PUT /api/profile. Synchronous convenience wrapper over
// app/_lib/profile-draft-run.ts; the UI runs drafting through the background
// task kind "profile_draft" (tracked, refresh-safe), both share runProfileDraft.
export async function POST(request: NextRequest) {
  try {
    // Both guards precede the body read: a caller who may not spend must not even
    // reach the parse, and open mode (no KP_OPERATOR_PASSWORD) makes the gate a no-op
    // exactly as it does everywhere else, so dev and the keyless e2e are unaffected.
    const denied = await requireOperator();
    if (denied) return denied;
    if (!rateLimit(`profile-draft:${clientIpFrom(request.headers)}`, DRAFT_RATE_LIMIT)) {
      return jsonRefusal("TOO_MANY_REQUESTS", 429);
    }
    const body = (await request.json()) as { text?: string };
    // request.signal: closing the modal / navigating away SIGKILLs the orphaned
    // Gemini child instead of letting it burn a paid call nobody reads.
    const draft = await runProfileDraft(
      { text: body.text ?? "", lang: await getServerLocale() },
      request.signal
    );
    return NextResponse.json(draft);
  } catch (error) {
    if (error instanceof ProfileDraftError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "AI draft failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
