import { NextResponse } from "next/server";
import { getJob, listJdRevisions, loadJd, revertJd } from "@/app/_lib/db";
import { ingestJobAd } from "@/app/_lib/job-ingest";
import { safeJsonError } from "@/app/_lib/api-response";

export const runtime = "nodejs";
// A revert re-ingests the linked job — one LLM parse, best-effort.
export const maxDuration = 60;

// JD edit history (idea-6a18e0fc). GET lists the pre-edit snapshots (newest first);
// POST { revisionId } reverts the JD to that snapshot. The destructive in-place
// PATCH used to make a typo unrecoverable; now every edit is diff-able + revertable.
export async function GET(_request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  try {
    if (!loadJd(slug)) return NextResponse.json({ error: "JD not found." }, { status: 404 });
    return NextResponse.json({ revisions: listJdRevisions(slug) });
  } catch (error) {
    return safeJsonError(error, "api:jds/revisions", "JD_LOAD_FAILED");
  }
}

export async function POST(request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  try {
    const body = (await request.json().catch(() => ({}))) as { revisionId?: unknown };
    const revisionId = typeof body.revisionId === "number" ? body.revisionId : NaN;
    if (!Number.isFinite(revisionId)) {
      return NextResponse.json({ error: "revisionId is required." }, { status: 400 });
    }
    const restored = revertJd(slug, revisionId);
    if (!restored) return NextResponse.json({ error: "Revision or JD not found." }, { status: 404 });

    // Keep the linked jd-<slug> job in step with the reverted wording — best-effort,
    // mirroring the PATCH edit path (insertJob preserves lifecycle status on upsert).
    let jobResynced = false;
    const jobId = `jd-${slug}`;
    if (getJob(jobId)) {
      try {
        await ingestJobAd(restored.body, jobId);
        jobResynced = true;
      } catch (ingestError) {
        console.error(`[api:jds/revisions] JD ${slug} reverted but job re-ingest failed`, ingestError);
      }
    }
    return NextResponse.json({ ok: true, restored, jobResynced });
  } catch (error) {
    return safeJsonError(error, "api:jds/revisions", "JD_SAVE_FAILED");
  }
}
