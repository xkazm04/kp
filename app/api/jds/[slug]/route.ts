import { NextResponse } from "next/server";
import { getJob, loadJd, setJdArchived, updateJd } from "@/app/_lib/db";
import { ingestJobAd } from "@/app/_lib/job-ingest";
import { jdJobId, validateJdFields } from "@/app/_lib/jd-limits";
import { safeJsonError } from "@/app/_lib/api-response";

export const runtime = "nodejs";
// The best-effort re-ingest on a body edit is one LLM parse.
export const maxDuration = 60;

export async function GET(_request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  try {
    const row = loadJd(slug);
    if (!row) {
      return NextResponse.json({ error: "JD not found." }, { status: 404 });
    }
    return NextResponse.json(row);
  } catch (error) {
    return safeJsonError(error, "api:jds/[slug]", "JD_LOAD_FAILED");
  }
}

// W8-4 (JDL1) — the library was fully append-only: no update, delete or
// archive path existed anywhere (the only DELETE FROM jds is the simulation
// cleaner). A typo'd JD was permanent; the only "fix" was a duplicate under a
// new slug, forking the analysis history keyed on jd_slug.
// PATCH supports two independent writes:
//   { title, body }      — edit in place (same validateJdFields as save);
//   { archived: bool }   — archive/unarchive (archived JDs leave listJds and
//                          the pickers; the public page renders with a banner).
export async function PATCH(request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  try {
    const existing = loadJd(slug);
    if (!existing) return NextResponse.json({ error: "JD not found." }, { status: 404 });

    const body = (await request.json().catch(() => ({}))) as {
      title?: unknown;
      body?: unknown;
      archived?: unknown;
    };

    if (typeof body.archived === "boolean") {
      setJdArchived(slug, body.archived);
      return NextResponse.json({ ok: true, archived: body.archived });
    }

    const fields = validateJdFields(body.title, body.body);
    if (!fields.ok) {
      return NextResponse.json({ error: fields.error }, { status: 400 });
    }
    updateJd(slug, { title: fields.title, body: fields.body });

    // Keep the linked jd-<slug> job in step with the edited wording —
    // best-effort: insertJob's explicit-jobId upsert updates fields while
    // deliberately preserving lifecycle status, so an edit can't demote a
    // live role; a re-ingest failure leaves the JD edit committed.
    let jobResynced = false;
    const jobId = jdJobId(slug);
    if (getJob(jobId)) {
      try {
        await ingestJobAd(fields.body, jobId);
        jobResynced = true;
      } catch (ingestError) {
        console.error(`[api:jds] JD ${slug} edited but job re-ingest failed`, ingestError);
      }
    }
    return NextResponse.json({ ok: true, jobResynced });
  } catch (error) {
    return safeJsonError(error, "api:jds/[slug]", "JD_SAVE_FAILED");
  }
}
