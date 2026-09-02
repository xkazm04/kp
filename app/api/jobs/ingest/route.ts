import { NextRequest, NextResponse } from "next/server";
import { ingestJobAd, insertJob, jobContentHash } from "@/app/_lib/job-ingest";
import { canWriteJobLifecycle } from "@/app/_lib/db/jobs";
import { MIN_AD_CHARS } from "@/app/_lib/split-ads";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { jsonRefusal } from "@/app/_lib/api-response";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";

// The parser this route spawns builds ClaudeCliProvider(timeout=120) for the LLM
// ad-parse (pipeline/jobfit/jobs_cli.py). maxDuration must comfortably exceed that
// provider timeout, or a platform enforcing it (e.g. Vercel) kills a slow-but-valid
// parse at 60s — surfacing a 504 on work that would have succeeded and orphaning a
// Python child that keeps burning a subscription call.
export const maxDuration = 180;

// Direction #1: turn a prose job ad into a structured, matchable Job in the
// corpus. The Claude CLI parses the ad (jobs_cli ingest); the result is upserted
// and content-hash-guarded so the same ad doesn't pile up duplicate jobs.
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { adText?: string; jobId?: unknown };
    const adText = (body.adText ?? "").trim();
    if (adText.length < MIN_AD_CHARS) {
      return NextResponse.json({ error: `Provide the full job ad text (at least ~${MIN_AD_CHARS} chars).` }, { status: 400 });
    }
    const ws = await currentWorkspace();

    // An explicit jobId means "re-parse this ad INTO that existing job", i.e. a content
    // overwrite of a named row — insertJob's ON CONFLICT UPDATE rewrites its title,
    // company, salary band and payload. That is a write, and the by-id write needs the
    // same ownership gate /close and /publish carry (jobs-tenancy.test.ts): unguarded,
    // team B could POST team A's job id and rewrite A's live opening — the row keeps A's
    // workspace_id and 'published' status, so A's catalog and A's apply link silently
    // start serving B's ad. 404 (not 403) so the endpoint can't be used to probe ids.
    // Seeded corpus rows (workspace_id NULL) stay writable by every tenant, matching the
    // documented canWriteJobLifecycle decision.
    const explicitJobId = typeof body.jobId === "string" && body.jobId.trim() ? body.jobId.trim() : undefined;
    if (explicitJobId && !canWriteJobLifecycle(explicitJobId, ws)) {
      return NextResponse.json({ error: "Job not found." }, { status: 404 });
    }

    // Per-IP, AFTER the cheap refusals (too-short ad, unknown/foreign jobId) so a
    // rejected paste costs no budget, and BEFORE the Claude CLI child that parses the
    // ad. 20/10min: pasting an ad is a deliberate, one-at-a-time act — the bulk paste
    // the splitter feeds is still one request per ad, so twenty in ten minutes sits far
    // above honest use while a scripted loop is pinned. Operator-gated deploys stop a
    // stranger; open mode (KP_OPERATOR_PASSWORD unset) makes that a no-op for the whole
    // API, so the route must self-limit.
    if (!rateLimit(`jobs-ingest:${clientIpFrom(request.headers)}`, { limit: 20, windowMs: 10 * 60_000 })) {
      return jsonRefusal("TOO_MANY_REQUESTS", 429);
    }

    // Thread the request's AbortSignal so abandoning the ingest (navigating away
    // mid-parse) SIGKILLs the Claude CLI child instead of leaving it to finish a
    // parse whose result nobody will read — and keep spending a subscription call.
    const { job, source } = await ingestJobAd(adText, explicitJobId, request.signal);
    // Ingest as a DRAFT (insertJob defaults to "published"). A pasted ad must enter the same
    // draft → publish → source-into-pipeline lifecycle that JD-builder roles get; born
    // "published" it skipped publish, so the role was live but never sourced candidates.
    // Publishing it (Jobs tab) then runs sourcing exactly like an authored JD.
    //
    // derivedId when the caller named no job: the parser's id is then just a slug of the
    // ad's TITLE, so two different roles that share a title must fork, not overwrite.
    const { id, created } = insertJob(job, jobContentHash(adText), "draft", ws, {
      derivedId: !explicitJobId,
    });
    return NextResponse.json({ jobId: id, created, source, title: job.title });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Job ingestion failed." },
      { status: 500 }
    );
  }
}
