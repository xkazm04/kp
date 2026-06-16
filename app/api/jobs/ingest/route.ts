import { NextRequest, NextResponse } from "next/server";
import { ingestJobAd, insertJob, jobContentHash } from "@/app/_lib/job-ingest";
import { MIN_AD_CHARS } from "@/app/_lib/split-ads";

export const runtime = "nodejs";
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
    const body = (await request.json()) as { adText?: string; jobId?: string };
    const adText = (body.adText ?? "").trim();
    if (adText.length < MIN_AD_CHARS) {
      return NextResponse.json({ error: `Provide the full job ad text (at least ~${MIN_AD_CHARS} chars).` }, { status: 400 });
    }

    // Thread the request's AbortSignal so abandoning the ingest (navigating away
    // mid-parse) SIGKILLs the Claude CLI child instead of leaving it to finish a
    // parse whose result nobody will read — and keep spending a subscription call.
    const { job, source } = await ingestJobAd(adText, body.jobId, request.signal);
    // Ingest as a DRAFT (insertJob defaults to "published"). A pasted ad must enter the same
    // draft → publish → source-into-pipeline lifecycle that JD-builder roles get; born
    // "published" it skipped publish, so the role was live but never sourced candidates.
    // Publishing it (Jobs tab) then runs sourcing exactly like an authored JD.
    const { id, created } = insertJob(job, jobContentHash(adText), "draft");
    return NextResponse.json({ jobId: id, created, source, title: job.title });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Job ingestion failed." },
      { status: 500 }
    );
  }
}
