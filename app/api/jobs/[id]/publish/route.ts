import { NextRequest, NextResponse } from "next/server";
import { activeJobsGate } from "@/app/_lib/billing";
import { createPipelineEntry, getJob } from "@/app/_lib/db";
import { countPublishedJobs, getJobStatus, setJobStatus } from "@/app/_lib/job-ingest";
import { runSourceForRole } from "@/app/_lib/devcase-run";
import { splitRequirements } from "@/app/features/sub_jobs/JobsTypes";

export const runtime = "nodejs";
export const maxDuration = 60;

// Take a draft job live: flip its status to 'published' and source candidates
// into the pipeline (the step that used to happen implicitly on save). Idempotent
// — re-running doesn't re-source.
//
// User-facing this is "Source into Pipeline" (internal go-live), NOT external
// "Publish to job boards". The route name and the 'published' DB status are kept
// as a stable contract. See docs/JD_LIFECYCLE.md.
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const job = getJob(id);
    if (!job) return NextResponse.json({ error: "Job not found." }, { status: 404 });

    const already = getJobStatus(id) === "published";
    // Billing hard gate: the free plan allows 1 concurrently-active authored
    // job. Re-publishing an already-live job is always allowed (idempotent).
    if (!already) {
      const quota = activeJobsGate(countPublishedJobs());
      if (quota) return NextResponse.json(quota, { status: 402 });
    }
    setJobStatus(id, "published");

    let sourced = 0;
    let skipped = 0;
    // Soft-warning: set when the sourcing step itself errors (Python/CLI failure),
    // so callers can tell "sourced 0 because nobody matched" apart from "sourced 0
    // because sourcing broke". null = sourcing ran cleanly (even if it found nobody).
    let sourcingWarning: string | null = null;
    if (!already) {
      try {
        const reqs = ((job as { requirements?: { skill: string; kind?: string }[] }).requirements ?? []);
        // Single-sourced split (JobsTypes.splitRequirements) so the sourcing
        // must-haves can't diverge from the published posting's must/nice buckets.
        const { mustHaves, niceToHaves } = splitRequirements(reqs);
        const role = {
          title: job.title,
          seniority: job.seniority,
          roleFamily: job.roleFamily,
          languages: job.languages ?? [],
          mustHaves,
          niceToHaves,
          responsibilities: job.description ? [job.description] : [],
        };
        // Thread the request's AbortSignal so abandoning the publish (closing the
        // modal mid-source) SIGKILLs the sourcing child instead of leaving it to
        // run — and keep spending — to the backstop.
        const outcome = await runSourceForRole(role, { signal: request.signal });
        skipped = outcome.skipped;
        for (const m of outcome.candidates) {
          if (!m.candidateId) continue;
          createPipelineEntry({
            candidateId: m.candidateId,
            candidateLabel: m.label,
            archetype: m.archetype,
            roleFamily: job.roleFamily ?? null,
            jobId: id,
            jobTitle: job.title,
            matchScore: m.score,
            stage: "Accepted",
          });
          sourced += 1;
        }
      } catch (sourcingError) {
        // Sourcing is best-effort — the role still goes live — but DON'T swallow the
        // reason. A broken pipeline that emits 0 candidates looks identical to an
        // empty pool unless we surface why. The warning flows to the draft note.
        sourcingWarning =
          sourcingError instanceof Error ? sourcingError.message : "Sourcing failed for an unknown reason.";
      }
    }

    // `skipped` = candidates whose payload failed to parse (not low matches), so an empty
    // pipeline after publish can be told apart from a pool that failed to load.
    // `sourcingWarning` (non-null) = the sourcing step errored; the UI shows it instead of
    // a misleading "sourced 0" success.
    return NextResponse.json({ ok: true, status: "published", sourced, skipped, sourcingWarning, alreadyPublished: already });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Sourcing failed." }, { status: 500 });
  }
}
