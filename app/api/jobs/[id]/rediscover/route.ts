import { NextResponse } from "next/server";
import { getJob } from "@/app/_lib/db";
import { rediscoverForJob } from "@/app/_lib/rediscover";


// Talent rediscovery (on-demand panel): rank the whole candidate pool against
// THIS job and surface "silver medalists" — people rejected/closed elsewhere (or
// parked in a different role) who clear the bar for this one and aren't already
// in it. The ranking + filtering live in app/_lib/rediscover.ts so the standing
// alert triggers (publish + sweep, idea-fdb45cd0) score candidates identically.
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const job = getJob(id);
    if (!job) return NextResponse.json({ error: "Job not found." }, { status: 404 });

    // Threads the request's AbortSignal so abandoning rediscovery (clicking to the
    // next role, closing the panel) promptly SIGKILLs the recruiter_cli child.
    const { rediscovered, skipped, more } = await rediscoverForJob(job, { signal: request.signal });
    return NextResponse.json({
      job: { id: job.id, title: job.title },
      rediscovered,
      // Candidates the ranker couldn't score (malformed profile). Threaded through
      // so rediscovery — whose whole promise is "we won't let strong past
      // candidates fall through the cracks" — never silently drops them.
      skipped,
      more,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Rediscovery failed." },
      { status: 500 }
    );
  }
}
