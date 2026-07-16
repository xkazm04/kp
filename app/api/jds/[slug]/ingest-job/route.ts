import { NextResponse } from "next/server";
import { getJob, loadJd } from "@/app/_lib/db";
import { ingestJobAd } from "@/app/_lib/job-ingest";
import { jdJobId } from "@/app/_lib/jd-limits";
import { safeJsonError } from "@/app/_lib/api-response";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";

// One LLM parse of the JD body — same budget class as the jobs-tab ingest.
export const maxDuration = 60;

// W8-3 (JDL3) — make a directly-saved JD matchable. Only the AI-builder path created
// the jd-<slug> Job; a JD saved straight to the library (JdBuilder's "Save as draft"
// or the Analyze tab's inline save) was analysis-only forever — never sourceable, rankable,
// matchable or applicable, even though the hardened LLM bridge (ingestJobAd:
// content-hash dedup, draft lifecycle) existed one tab away. The explicit
// jobId "jd-<slug>" makes JD and Job share identity, so the W8-2 apply CTA
// and the analyses sidebar line up in both directions.
export async function POST(_request: Request, context: { params: Promise<{ slug: string }> }) {
  // Making a JD matchable runs one LLM parse — a paid write, recruiter-only. Gate
  // before resolving params or touching the DB. Open mode is a no-op.
  const denied = await requireOperator();
  if (denied) return denied;
  const { slug } = await context.params;
  try {
    const jd = loadJd(slug, await currentWorkspace());
    if (!jd) return NextResponse.json({ error: "JD not found." }, { status: 404 });

    const jobId = jdJobId(slug);
    if (getJob(jobId)) {
      return NextResponse.json({ ok: true, jobId, already: true });
    }
    const { job, source } = await ingestJobAd(jd.body, jobId);
    return NextResponse.json({ ok: true, jobId: job.id ?? jobId, already: false, source });
  } catch (error) {
    return safeJsonError(error, "api:jds:ingest-job", "JD_SAVE_FAILED");
  }
}
