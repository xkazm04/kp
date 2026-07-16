import { NextResponse } from "next/server";
import { getTask, loadJd, markJdAnalyzing, setJdAnalysisTask, type JdBuildIntent } from "@/app/_lib/db";
import { startTask } from "@/app/_lib/tasks";
import { getTemplate } from "@/app/_lib/templates-store";
import { safeJsonError } from "@/app/_lib/api-response";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";

// Reconstruct the jd_build params from the JD row's persisted intent — the
// row-fallback replay path when the original task record has been pruned. Mirrors
// the shape POST /api/jds/generate hands startTask, re-resolving templateBody from
// the stored templateId (which is durable; the resolved body isn't). NULL/blank
// intent ⇒ null (a legacy row with neither task nor intent → the 400 below).
function paramsFromIntent(title: string, raw: string | null | undefined): Record<string, unknown> | null {
  if (!raw) return null;
  let intent: JdBuildIntent;
  try {
    intent = JSON.parse(raw) as JdBuildIntent;
  } catch {
    return null;
  }
  const templateBody =
    typeof intent.templateId === "string" && intent.templateId ? getTemplate(intent.templateId)?.body : undefined;
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
// replays startTask("jd_build", params) with jdSlug forced to THIS row, and resets
// the row to 'analyzing' up front so the Ledger reflects the re-run immediately.
// Params source, in order: the failed task's params_json (the exact inputs the run
// took) FIRST; if that task row was pruned, the JD row's persisted build intent as
// a fallback. Only a legacy row with NEITHER a live task nor stored intent still
// dead-ends at the 400.
export async function POST(_request: Request, context: { params: Promise<{ slug: string }> }) {
  // A retry REPLAYS the paid 1–2 minute AI build, so it carries the same
  // token-spend exposure as generate — gate before params or any DB read. Open
  // mode is a no-op.
  const denied = await requireOperator();
  if (denied) return denied;
  const { slug } = await context.params;
  try {
    const jd = loadJd(slug, await currentWorkspace());
    if (!jd) return NextResponse.json({ error: "JD not found." }, { status: 404 });
    if (jd.analysis_status !== "failed") {
      return NextResponse.json({ error: "This JD isn't in a failed state." }, { status: 409 });
    }
    const oldTask = jd.analysis_task_id ? getTask(jd.analysis_task_id) : null;
    // Task-first (exact params), then the durable row intent, else nothing to replay.
    const replayParams = oldTask
      ? ((oldTask.params as Record<string, unknown>) ?? {})
      : paramsFromIntent(jd.title, jd.build_input_json);
    if (!replayParams) return NextResponse.json({ error: "No build to retry." }, { status: 400 });

    markJdAnalyzing(slug);
    // Force jdSlug even for legacy params so the replay re-fills THIS row. The old
    // task is terminal, so its (now slug-keyed) dedupe entry won't merge this run.
    const task = startTask("jd_build", { ...replayParams, jdSlug: slug });
    setJdAnalysisTask(slug, task.id);
    return NextResponse.json({ taskId: task.id });
  } catch (error) {
    return safeJsonError(error, "api:jds/retry-analysis", "JD_GENERATE_FAILED");
  }
}
