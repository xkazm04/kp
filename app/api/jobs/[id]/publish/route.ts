import { NextRequest, NextResponse } from "next/server";
import { createPipelineEntry, getJob } from "@/app/_lib/db";
import { getJobStatus, setJobStatus } from "@/app/_lib/job-ingest";
import { runSourceForRole } from "@/app/_lib/devcase-run";

export const runtime = "nodejs";
export const maxDuration = 60;

// Take a draft job live: flip its status to 'published' and source candidates
// into the pipeline (the step that used to happen implicitly on save). Idempotent
// — re-running doesn't re-source.
//
// User-facing this is "Source into Pipeline" (internal go-live), NOT external
// "Publish to job boards". The route name and the 'published' DB status are kept
// as a stable contract. See docs/JD_LIFECYCLE.md.
export async function POST(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const job = getJob(id);
    if (!job) return NextResponse.json({ error: "Job not found." }, { status: 404 });

    const already = getJobStatus(id) === "published";
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
        const role = {
          title: job.title,
          seniority: job.seniority,
          roleFamily: job.roleFamily,
          languages: job.languages ?? [],
          mustHaves: reqs.filter((r) => r.kind !== "nice_to_have").map((r) => r.skill),
          niceToHaves: reqs.filter((r) => r.kind === "nice_to_have").map((r) => r.skill),
          responsibilities: job.description ? [job.description] : [],
        };
        const outcome = await runSourceForRole(role);
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
