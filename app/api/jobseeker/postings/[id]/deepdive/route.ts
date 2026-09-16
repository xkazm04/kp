import { NextResponse } from "next/server";
import { jsonRefusal, safeJsonError, requireCapabilityCoded } from "@/app/_lib/api-response";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { requireCapability } from "@/app/_lib/auth/current-user";
import { getJobseekerPosting, getPostingSummary } from "@/app/_lib/db/jobseeker-postings";
import { getWorkspaceJobseekerProfile } from "@/app/_lib/db/jobseeker-profiles";
import { deepDivePosting } from "@/app/_lib/jobseeker/deepdive";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";
import { isLocale } from "@/i18n/locales";

// POST /api/jobseeker/postings/[id]/deepdive — the LLM deep-dive for ONE posting, on
// demand and synchronously (WP4c): model re-structuring (jd_ingest), a re-match of that
// posting, the rationale (match_reasoning) → { posting, reasoning, source }. Keyless it
// answers 200 with `source: "deterministic"` and the engine's template rationale — one
// cheap spawn, nothing persisted (a template must not freeze the row out of an upgrade).
//
// The provider's own timeout is 120 s per call (jobs_cli / reasoning_cli); maxDuration is
// the serverless ceiling only — self-hosted `next start` is bounded by the spawn timeouts
// in deepdive.ts, not by this export.
//
// Operator-gated by the proxy AND re-verified here; the limiter is the real bound in open
// mode. 20/10min per IP — two model calls per request; the scan already deep-dives the
// shortlist, so this door is for the posting the seeker is looking at right now.

export const maxDuration = 120;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const denied = await requireOperator();
  if (denied) return denied;
  // The seeker's own data, but still a WRITE behind a seat: a viewer seat may read the
  // feed, not spend a scan, a model turn or a source acknowledgement (route-capability-coverage).
  const under = await requireCapabilityCoded("pipeline:write", requireCapability);
  if (under) return under;
  if (!rateLimit(`jobseeker-deepdive:${clientIpFrom(request.headers)}`, { limit: 20, windowMs: 10 * 60_000 })) {
    return jsonRefusal("TOO_MANY_REQUESTS", 429);
  }
  try {
    const { id } = await params;
    const ws = await currentWorkspace();
    const posting = getJobseekerPosting(id, ws);
    if (!posting) return jsonRefusal("POSTING_NOT_FOUND", 404);
    const profile = getWorkspaceJobseekerProfile(ws);
    if (!profile) return jsonRefusal("JOBSEEKER_PROFILE_MISSING", 409);
    const langParam = new URL(request.url).searchParams.get("lang");
    const lang = isLocale(langParam) ? langParam : "en";
    const outcome = await deepDivePosting(posting, profile, { lang, signal: request.signal, workspaceId: ws });
    return NextResponse.json({
      posting: getPostingSummary(id, ws),
      reasoning: outcome.kind === "no_provider" ? null : outcome.reasoning,
      source: outcome.kind === "done" ? "llm" : "deterministic",
      ...(outcome.kind === "no_provider" ? { fallbackReason: "no_provider" } : {}),
    });
  } catch (error) {
    return safeJsonError(error, "api:jobseeker/postings/[id]/deepdive", "JOBSEEKER_STORE_FAILED");
  }
}
