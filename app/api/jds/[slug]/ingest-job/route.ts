import { NextResponse } from "next/server";
import { getJob, loadJd } from "@/app/_lib/db/jobs";
import { ingestJobAd, insertJob } from "@/app/_lib/job-ingest";
import { jdJobId } from "@/app/_lib/jd-limits";
import { jsonRefusal, safeJsonError } from "@/app/_lib/api-response";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";

// THROTTLE: one accepted call spends a Claude ad-parse of the whole JD body in a
// spawned child. Same 20/10min per IP as POST /api/jobs/ingest, which guards the
// identical parse — this route is the JD-library door to it, and it was the only
// one of the two without a limiter. Operator-gated, and open mode makes that gate a
// no-op for the whole API.
const INGEST_JOB_RATE_LIMIT = { limit: 20, windowMs: 10 * 60_000 };

// One LLM parse of the JD body — same budget class as the jobs-tab ingest.
export const maxDuration = 60;

// W8-3 (JDL3) — make a directly-saved JD matchable. Only the AI-builder path created
// the jd-<slug> Job; a JD saved straight to the library (JdBuilder's "Save as draft"
// or the Analyze tab's inline save) was analysis-only forever — never sourceable, rankable,
// matchable or applicable, even though the hardened LLM bridge (ingestJobAd:
// content-hash dedup, draft lifecycle) existed one tab away. The explicit
// jobId "jd-<slug>" makes JD and Job share identity, so the W8-2 apply CTA
// and the analyses sidebar line up in both directions.
export async function POST(request: Request, context: { params: Promise<{ slug: string }> }) {
  // Making a JD matchable runs one LLM parse — a paid write, recruiter-only. Gate
  // before resolving params or touching the DB. Open mode is a no-op.
  const denied = await requireOperator();
  if (denied) return denied;
  const { slug } = await context.params;
  try {
    const ws = await currentWorkspace();
    const jd = loadJd(slug, ws);
    if (!jd) return NextResponse.json({ error: "JD not found." }, { status: 404 });

    const jobId = jdJobId(slug);
    if (getJob(jobId)) {
      return NextResponse.json({ ok: true, jobId, already: true });
    }
    // The budget is spent HERE: after the 404 AND after the already-ingested
    // short-circuit above, which parses nothing and so must neither consume nor be
    // masked by the budget — and before the parse this guards.
    if (!rateLimit(`jd-ingest-job:${clientIpFrom(request.headers)}`, INGEST_JOB_RATE_LIMIT)) {
      return jsonRefusal("TOO_MANY_REQUESTS", 429);
    }
    const { job, source } = await ingestJobAd(jd.body, jobId);
    // ingestJobAd only PARSES (it spawns jobs_cli and hands back the structured
    // record); `insertJob` is the sole writer of the `jobs` table. Without this the
    // route burned a Claude ad-parse and answered `{ ok: true, already: false }`
    // while nothing was written — the JD stayed `unlinked`, "Source into Pipeline"
    // 404'd, and every re-click re-spent the parse. Same shape as
    // POST /api/jobs/ingest, scoped to the workspace that owns the JD (proven by
    // the loadJd above) so the opening lands in the corpus of the team that asked.
    //
    // Deliberately NO content hash: the JD↔Job identity contract is `jd-<slug>`
    // (jd-limits.ts), and insertJob's content-twin dedup would hand back an
    // unrelated job id — leaving the JD unlinked while the response claimed
    // success. The `getJob` short-circuit above already makes this idempotent.
    const { id } = insertJob({ ...job, id: jobId }, undefined, "draft", ws);
    return NextResponse.json({ ok: true, jobId: id, already: false, source });
  } catch (error) {
    return safeJsonError(error, "api:jds:ingest-job", "JD_SAVE_FAILED");
  }
}
