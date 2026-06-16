import { NextResponse } from "next/server";
import { entryIdsWithEvent, getJob, listEntriesForJob } from "@/app/_lib/db";
import { buildCandidatePool } from "@/app/_lib/candidate-pool";
import { rankPoolForJob } from "@/app/_lib/recruiter-run";
import { PipelineError } from "@/app/_lib/python-runner";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const job = getJob(id);
    if (!job) {
      return NextResponse.json({ error: "Job not found." }, { status: 404 });
    }

    // Shared pool (v2 profiles + saved CV analyses) — the same population
    // rediscovery scores, so the two views never diverge.
    const entries = buildCandidatePool();

    if (entries.length === 0) {
      return NextResponse.json({ job: null, candidates: [], note: "No saved candidates yet." });
    }

    // Pass the DB job directly so newly-ingested jobs (not in the static corpus)
    // rank too. Thread the request's AbortSignal so abandoning this scan (clicking
    // to the next role, closing the modal) promptly SIGKILLs the recruiter_cli
    // child instead of letting it run to the 600s backstop and pile up orphaned
    // ranking processes that contend for CPU.
    const payload = await rankPoolForJob<{ candidates?: Array<Record<string, unknown>> } & Record<string, unknown>>(
      id,
      entries,
      job,
      { signal: request.signal },
    );

    // W8-5 (JOB2) — persist the sourcing state on the ranking. "Reach out" and
    // "+ pipeline" state lived only in the hooks' in-memory Sets: reopen the
    // role tomorrow and every candidate — including ones already filed or
    // already sent a first-touch — showed fresh, active buttons. The durable
    // truth was always server-side (entries keyed jobId+candidateId; the
    // per-entry outreach_sent event); decorate each ranked row with it.
    const jobEntries = listEntriesForJob(id).filter((e) => e.status === "active" && e.candidateId);
    const entryByCandidate = new Map(jobEntries.map((e) => [e.candidateId as string, e]));
    const reachedEntryIds = entryIdsWithEvent(
      jobEntries.map((e) => e.id),
      "outreach_sent"
    );
    for (const row of payload.candidates ?? []) {
      const candidateId = typeof row.candidateId === "string" ? row.candidateId : null;
      const entry = candidateId ? entryByCandidate.get(candidateId) : undefined;
      row.inPipeline = entry?.stage ?? null;
      row.outreachSent = entry ? reachedEntryIds.has(entry.id) : false;
    }
    return NextResponse.json(payload);
  } catch (error) {
    // A recruiter_cli failure surfaces as a PipelineError carrying the CLI's
    // status/code (e.g. a 400 invalid_input), so a user-fixable failure stays a
    // 400 instead of collapsing to 500 — preserving the prior inline behavior.
    if (error instanceof PipelineError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Failed to rank candidates.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
