import { NextResponse } from "next/server";
import { getJob, jobVisibleToWorkspace } from "@/app/_lib/db/jobs";
import { entryIdsWithEvent, listEntriesForJob } from "@/app/_lib/db/pipeline";
import { buildCandidatePool } from "@/app/_lib/candidate-pool";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { rankPoolForJob } from "@/app/_lib/recruiter-run";
import { PipelineError } from "@/app/_lib/python-runner";
import { jsonRefusal, safeJsonError } from "@/app/_lib/api-response";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";


export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    // Resolved ONCE and reused by the visibility gate, the pool read and the
    // sourcing-state decoration below: the pool and the pipeline it is decorated
    // against must be read from the same tenant or the join is nonsense.
    const workspaceId = await currentWorkspace();
    // Visibility gate, same as every other by-id job route (winnability, rediscover,
    // campaign, agent-fit; docs/features/jobs README § "By-id job routes re-apply
    // the list's visibility predicate"): getJob is a by-id point read over a
    // globally-unique PK, so unguarded this ranked the caller's whole pool against
    // ANY tenant's role and handed back a per-candidate breakdown of that role's
    // must-haves, KO floors and requirement matches — while spending a
    // recruiter_cli child fed the role's title, body and stated band. 404, not 403,
    // so the endpoint can't confirm another team's id exists; seeded corpus rows
    // stay visible to everyone.
    const job = getJob(id);
    if (!job || !jobVisibleToWorkspace(id, workspaceId)) {
      return NextResponse.json({ error: "Job not found." }, { status: 404 });
    }

    // Shared pool (v2 profiles + saved CV analyses) — the same population
    // rediscovery scores, so the two views never diverge. Workspace-scoped so a
    // job only ranks against its own tenant's candidates.
    const { entries, truncated } = buildCandidatePool(workspaceId);

    if (entries.length === 0) {
      return NextResponse.json({ job: null, candidates: [], note: "No saved candidates yet." });
    }

    // Per-IP, AFTER the visibility gate and the empty-pool short-circuit (both must keep
    // answering freely — neither spawns anything) and BEFORE the recruiter_cli child.
    // 30/10min: the panel ranks once per role opened, so clicking through a shortlist of
    // roles is a legitimate burst, while a polling tab is pinned. Tighter than publish's
    // budget because this is a per-REQUEST spawn a reader triggers by navigating.
    if (!rateLimit(`jobs-candidates:${clientIpFrom(request.headers)}`, { limit: 30, windowMs: 10 * 60_000 })) {
      return jsonRefusal("TOO_MANY_REQUESTS", 429);
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
    //
    // Both reads carry `workspaceId`. Bare, they answered for the DEFAULT tenant, so
    // on any other team no entry and no outreach marker ever matched and the whole
    // decoration collapsed to `inPipeline: null, outreachSent: false` — every
    // already-filed, already-contacted candidate came back wearing a fresh
    // "+ pipeline" / "Reach out" button, and a recruiter clicking it sent a second
    // first-touch email to someone already mid-funnel. That is precisely the
    // regression W8-5 above exists to prevent, reintroduced one tenant over.
    const jobEntries = listEntriesForJob(id, workspaceId).filter((e) => e.status === "active" && e.candidateId);
    const entryByCandidate = new Map(jobEntries.map((e) => [e.candidateId as string, e]));
    const reachedEntryIds = entryIdsWithEvent(
      jobEntries.map((e) => e.id),
      "outreach_sent",
      workspaceId
    );
    for (const row of payload.candidates ?? []) {
      const candidateId = typeof row.candidateId === "string" ? row.candidateId : null;
      const entry = candidateId ? entryByCandidate.get(candidateId) : undefined;
      row.inPipeline = entry?.stage ?? null;
      row.outreachSent = entry ? reachedEntryIds.has(entry.id) : false;
    }
    // Honest cap signal: true means the corpus exceeds the pool caps, so some
    // candidates were never scored here (the overflow is excluded, not ranked low).
    return NextResponse.json({ ...payload, poolTruncated: truncated });
  } catch (error) {
    // A recruiter_cli failure surfaces as a PipelineError carrying the CLI's
    // status/code (e.g. a 400 invalid_input), so a user-fixable failure stays a
    // 400 instead of collapsing to 500 — preserving the prior inline behavior.
    if (error instanceof PipelineError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return safeJsonError(error, "api:jobs/candidates", "JOB_CANDIDATES_FAILED");
  }
}
