import { NextResponse } from "next/server";
import { getJob, jobVisibleToWorkspace } from "@/app/_lib/db/jobs";
import { rediscoverForJob } from "@/app/_lib/rediscover";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { jsonRefusal, safeJsonError } from "@/app/_lib/api-response";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";


// Talent rediscovery (on-demand panel): rank the whole candidate pool against
// THIS job and surface "silver medalists" — people rejected/closed elsewhere (or
// parked in a different role) who clear the bar for this one and aren't already
// in it. The ranking + filtering live in app/_lib/rediscover.ts so the standing
// alert triggers (publish + sweep, idea-fdb45cd0) score candidates identically.
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    // Visibility gate (mirrors GET /api/jobs/[id]): getJob is a by-id point read over a
    // globally-unique PK, so unguarded this ranked the CALLER's pool against ANOTHER
    // team's role and echoed that role's title back — plus it spawned a recruiter_cli
    // child per call. Gate before the spawn. 404, not 403, so the endpoint can't be used
    // to probe ids; seeded corpus rows stay visible to every tenant.
    const ws = await currentWorkspace();
    const job = getJob(id);
    if (!job || !jobVisibleToWorkspace(id, ws)) {
      return NextResponse.json({ error: "Job not found." }, { status: 404 });
    }

    // Per-IP, AFTER the visibility gate (a refused role costs no budget) and BEFORE the
    // recruiter_cli child that ranks the whole pool. 30/10min matches the candidates
    // ranking next door: the panel spawns once per role opened, so browsing a shortlist
    // is legitimate while a reopening panel cannot keep the box busy.
    if (!rateLimit(`jobs-rediscover:${clientIpFrom(request.headers)}`, { limit: 30, windowMs: 10 * 60_000 })) {
      return jsonRefusal("TOO_MANY_REQUESTS", 429);
    }

    // Threads the request's AbortSignal so abandoning rediscovery (clicking to the
    // next role, closing the panel) promptly SIGKILLs the recruiter_cli child.
    const { rediscovered, skipped, more, suppressed } = await rediscoverForJob(job, {
      signal: request.signal,
      workspaceId: ws,
    });
    return NextResponse.json({
      job: { id: job.id, title: job.title },
      rediscovered,
      // Candidates the ranker couldn't score (malformed profile). Threaded through
      // so rediscovery — whose whole promise is "we won't let strong past
      // candidates fall through the cracks" — never silently drops them.
      skipped,
      more,
      // Pool members withheld by the consent gate (anonymized/erased, or every
      // grant lapsed). A COUNT, never a list — naming them would put the identity
      // back on the wire the suppression exists to keep off it. The panel says so:
      // an unexplained short list is the one thing this surface, whose promise is
      // that nobody falls through the cracks, must never show.
      suppressed,
    });
  } catch (error) {
    return safeJsonError(error, "api:jobs/rediscover", "JOB_REDISCOVER_FAILED");
  }
}
