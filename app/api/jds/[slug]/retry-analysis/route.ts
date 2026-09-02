import { NextResponse } from "next/server";
import { loadJd, type JdBuildIntent } from "@/app/_lib/db/jobs";
import { getTask } from "@/app/_lib/db/tasks";
import { restartJdBuild } from "@/app/_lib/jd-build-start";
import { getTemplate } from "@/app/_lib/templates-store";
import { jsonRefusal, safeJsonError } from "@/app/_lib/api-response";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";

// THROTTLE: a retry REPLAYS the full paid build, so it carries generate's exposure
// with none of its typing effort — one click per re-run. Same 20/10min per IP as
// generate, for the same reason and on the same budget family; the route is
// operator-gated and open mode makes that gate a no-op for the whole API. Metering
// the re-spend is a BILLING decision and not what this is.
const RETRY_RATE_LIMIT = { limit: 20, windowMs: 10 * 60_000 };

// Reconstruct the jd_build params from the JD row's persisted intent — the
// row-fallback replay path when the original task record has been pruned. Mirrors
// the shape POST /api/jds/generate hands the seam, re-resolving templateBody from
// the stored templateId (which is durable; the resolved body isn't). NULL/blank
// intent ⇒ null (a legacy row with neither task nor intent → the 400 below).
function paramsFromIntent(title: string, raw: string | null | undefined, workspaceId: string): Record<string, unknown> | null {
  if (!raw) return null;
  let intent: JdBuildIntent;
  try {
    intent = JSON.parse(raw) as JdBuildIntent;
  } catch {
    return null;
  }
  // Resolve the stored template in the JD's OWN workspace (tenancy): getTemplate
  // has a defaulted workspaceId, so an unscoped call replayed against the DEFAULT
  // team's templates — dropping a non-default team's format on every retry.
  const templateBody =
    typeof intent.templateId === "string" && intent.templateId ? getTemplate(intent.templateId, workspaceId)?.body : undefined;
  return {
    title,
    company: intent.company,
    seniority: intent.seniority,
    roleFamily: intent.roleFamily,
    needText: intent.needText,
    repoUrl: intent.repoUrl,
    lang: intent.lang,
    templateBody,
    options: intent.options,
  };
}

// POST /api/jds/[slug]/retry-analysis — re-run a failed backgrounded build. It
// replays the build through the shared seam with jdSlug forced to THIS row, and resets
// the row to 'analyzing' up front so the Ledger reflects the re-run immediately.
// Params source, in order: the failed task's params_json (the exact inputs the run
// took) FIRST; if that task row was pruned, the JD row's persisted build intent as
// a fallback. Only a legacy row with NEITHER a live task nor stored intent still
// dead-ends at the 400.
export async function POST(request: Request, context: { params: Promise<{ slug: string }> }) {
  // A retry REPLAYS the paid 1–2 minute AI build, so it carries the same
  // token-spend exposure as generate — gate before params or any DB read. Open
  // mode is a no-op.
  const denied = await requireOperator();
  if (denied) return denied;
  const { slug } = await context.params;
  try {
    const ws = await currentWorkspace();
    const jd = loadJd(slug, ws);
    if (!jd) return NextResponse.json({ error: "JD not found." }, { status: 404 });
    if (jd.analysis_status !== "failed") {
      return NextResponse.json({ error: "This JD isn't in a failed state." }, { status: 409 });
    }
    const oldTask = jd.analysis_task_id ? getTask(jd.analysis_task_id) : null;
    // Task-first (exact params), then the durable row intent, else nothing to replay.
    const replayParams = oldTask
      ? ((oldTask.params as Record<string, unknown>) ?? {})
      : paramsFromIntent(jd.title, jd.build_input_json, ws);
    if (!replayParams) return NextResponse.json({ error: "No build to retry." }, { status: 400 });

    // The budget is spent HERE: after the 404, the not-failed 409 and the
    // nothing-to-replay 400, so a click that was never going to re-run costs
    // nothing, and before the reset + the spawn.
    if (!rateLimit(`jd-retry:${clientIpFrom(request.headers)}`, RETRY_RATE_LIMIT)) {
      return jsonRefusal("TOO_MANY_REQUESTS", 429);
    }
    // Reset → replay → relink through the shared seam. It forces jdSlug even for
    // legacy params so the replay re-fills THIS row; the old task is terminal, so
    // its (now slug-keyed) dedupe entry won't merge this run. Same tenant the JD row
    // lives in (proven by the scoped loadJd above).
    const { taskId } = restartJdBuild(slug, replayParams, ws);
    return NextResponse.json({ taskId });
  } catch (error) {
    return safeJsonError(error, "api:jds/retry-analysis", "JD_GENERATE_FAILED");
  }
}
