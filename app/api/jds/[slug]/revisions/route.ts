import { NextResponse } from "next/server";
import { getJob, listJdRevisions, loadJd, revertJd } from "@/app/_lib/db/jobs";
import { ingestJobAd, insertJob } from "@/app/_lib/job-ingest";
import { jdJobId } from "@/app/_lib/jd-limits";
import { safeJsonError } from "@/app/_lib/api-response";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";

// A revert re-ingests the linked job — one LLM parse, best-effort.
export const maxDuration = 60;

// JD edit history (idea-6a18e0fc). GET lists the pre-edit snapshots (newest first);
// POST { revisionId } reverts the JD to that snapshot. The destructive in-place
// PATCH used to make a typo unrecoverable; now every edit is diff-able + revertable.
export async function GET(_request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  const ws = await currentWorkspace();
  try {
    if (!loadJd(slug, ws)) return NextResponse.json({ error: "JD not found." }, { status: 404 });
    return NextResponse.json({ revisions: listJdRevisions(slug, 30, ws) });
  } catch (error) {
    return safeJsonError(error, "api:jds/revisions", "JD_LOAD_FAILED");
  }
}

export async function POST(request: Request, context: { params: Promise<{ slug: string }> }) {
  // Revert mutates the live JD; it is exposed on the public page, so gate it
  // recruiter-only server-side. GET (history listing) above stays public.
  const denied = await requireOperator();
  if (denied) return denied;
  const { slug } = await context.params;
  const ws = await currentWorkspace();
  try {
    const body = (await request.json().catch(() => ({}))) as { revisionId?: unknown; baseBody?: unknown };
    const revisionId = typeof body.revisionId === "number" ? body.revisionId : NaN;
    if (!Number.isFinite(revisionId)) {
      return NextResponse.json({ error: "revisionId is required." }, { status: 400 });
    }
    // Content-CAS (same as the PATCH edit): refuse to revert over a body that changed
    // since the history view was opened, rather than burying that edit.
    const baseBody = typeof body.baseBody === "string" ? body.baseBody : undefined;
    const result = revertJd(slug, revisionId, baseBody, ws);
    if (!result.ok) {
      if (result.reason === "conflict") {
        return NextResponse.json(
          { error: "This JD changed since you opened the history — reload, then revert again.", code: "conflict" },
          { status: 409 }
        );
      }
      return NextResponse.json({ error: "Revision or JD not found." }, { status: 404 });
    }
    const restored = { title: result.title, body: result.body };

    // Keep the linked jd-<slug> job in step with the reverted wording — best-effort,
    // mirroring the PATCH edit path (insertJob preserves lifecycle status on upsert).
    // ingestJobAd parses; insertJob persists. Skipping the write made the revert
    // half a revert — the JD body rolled back while the matchable job kept the
    // requirements parsed from the text the operator just discarded.
    let jobResynced = false;
    const jobId = jdJobId(slug);
    if (getJob(jobId)) {
      try {
        const { job } = await ingestJobAd(restored.body, jobId);
        insertJob({ ...job, id: jobId }, undefined, "draft", ws);
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
