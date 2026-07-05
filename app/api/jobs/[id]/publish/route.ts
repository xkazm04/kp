import { NextRequest, NextResponse } from "next/server";
import { activeJobsGate } from "@/app/_lib/billing";
import { createPipelineEntry, ensureDb, getJob } from "@/app/_lib/db";
import { countPublishedJobs, getJobStatus, setJobStatus } from "@/app/_lib/job-ingest";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { runSourceForRole } from "@/app/_lib/devcase-run";
import { raiseRediscoveryAlertsForJob } from "@/app/_lib/rediscover";
import { splitRequirements } from "@/app/features/sub_jobs/JobsTypes";

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
  const ws = await currentWorkspace();
  try {
    const job = getJob(id);
    if (!job) return NextResponse.json({ error: "Job not found." }, { status: 404 });

    // Billing hard gate: the free plan allows 1 concurrently-active authored job.
    // Re-publishing an already-live job is always allowed (idempotent). The count
    // check and the status flip run in ONE db.transaction so two concurrent
    // publishes can't both read count=0 and both go live, bypassing the cap. (No
    // await sits between the count and the flip and better-sqlite3 is synchronous,
    // so this is atomic today too; the transaction enforces the invariant if an
    // await is ever introduced into this critical section.)
    const gate = ensureDb().transaction((): { already: boolean; quota: ReturnType<typeof activeJobsGate> } => {
      const wasPublished = getJobStatus(id) === "published";
      if (wasPublished) return { already: true, quota: null };
      const quota = activeJobsGate(countPublishedJobs(ws));
      if (!quota) setJobStatus(id, "published");
      return { already: false, quota };
    })();
    if (gate.quota) return NextResponse.json(gate.quota, { status: 402 });
    const already = gate.already;

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

    // fdb45cd0 — the moment a role goes live, raise standing rediscovery alerts:
    // rank the pool against it and persist "a candidate you rejected from Role X
    // clears the bar for this new role" hits to the dismissable feed. Best-effort
    // (raiseRediscoveryAlertsForJob swallows its own failures) and only on the
    // genuine go-live, not idempotent re-publishes. The just-sourced candidates
    // are excluded by rediscoverForJob (they're now active in this role).
    let silverMedalists = 0;
    if (!already) {
      silverMedalists = await raiseRediscoveryAlertsForJob(id, { signal: request.signal });
    }

    // `skipped` = candidates whose payload failed to parse (not low matches), so an empty
    // pipeline after publish can be told apart from a pool that failed to load.
    // `sourcingWarning` (non-null) = the sourcing step errored; the UI shows it instead of
    // a misleading "sourced 0" success.
    return NextResponse.json({ ok: true, status: "published", sourced, skipped, sourcingWarning, silverMedalists, alreadyPublished: already });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Sourcing failed." }, { status: 500 });
  }
}
