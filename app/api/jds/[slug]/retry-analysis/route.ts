import { NextResponse } from "next/server";
import { getTask, loadJd, markJdAnalyzing, setJdAnalysisTask } from "@/app/_lib/db";
import { startTask } from "@/app/_lib/tasks";
import { safeJsonError } from "@/app/_lib/api-response";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";

// POST /api/jds/[slug]/retry-analysis — re-run a failed backgrounded build. The
// original inputs (title/need/company/options/jdSlug…) live on the failed task's
// params_json, so the retry just replays startTask("jd_build", oldParams). It also
// resets the JD row to 'analyzing' up front so the Ledger reflects the re-run
// immediately, rather than showing 'failed' until the replay lands.
export async function POST(_request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  try {
    const jd = loadJd(slug, await currentWorkspace());
    if (!jd) return NextResponse.json({ error: "JD not found." }, { status: 404 });
    if (jd.analysis_status !== "failed") {
      return NextResponse.json({ error: "This JD isn't in a failed state." }, { status: 409 });
    }
    const oldTask = jd.analysis_task_id ? getTask(jd.analysis_task_id) : null;
    if (!oldTask) return NextResponse.json({ error: "No build to retry." }, { status: 400 });

    markJdAnalyzing(slug);
    // Force jdSlug even for legacy params so the replay re-fills THIS row. The old
    // task is terminal, so its (now slug-keyed) dedupe entry won't merge this run.
    const task = startTask("jd_build", { ...((oldTask.params as Record<string, unknown>) ?? {}), jdSlug: slug });
    setJdAnalysisTask(slug, task.id);
    return NextResponse.json({ taskId: task.id });
  } catch (error) {
    return safeJsonError(error, "api:jds/retry-analysis", "JD_GENERATE_FAILED");
  }
}
