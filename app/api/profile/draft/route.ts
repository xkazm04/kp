import { NextRequest, NextResponse } from "next/server";
import { ProfileDraftError, runProfileDraft } from "@/app/_lib/profile-draft-run";
import { getServerLocale } from "@/i18n/server";

// bug-ui-scan-2026-07-09 (pipeline-clis-script-bridges #2): this route spawns a
// Gemini child, so it needs a function budget wide enough for the child timeout
// inside runProfileDraft (55s) plus cleanup — the runner owns the child-timeout
// contract; maxDuration keeps the serverless platform from killing the function
// before the runner's finally{ cleanupWorkdir } runs.
export const maxDuration = 60;

// AI-assisted intake: free-text notes -> a routed CandidateProfileV2 draft the
// Profile editor loads for review. Does NOT persist — the recruiter edits then
// saves via POST/PUT /api/profile. Synchronous convenience wrapper over
// app/_lib/profile-draft-run.ts; the UI runs drafting through the background
// task kind "profile_draft" (tracked, refresh-safe), both share runProfileDraft.
export async function POST(request: NextRequest) {
  try {
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
