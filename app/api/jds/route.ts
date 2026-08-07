import { NextResponse } from "next/server";
import { countAnalysesByJd } from "@/app/_lib/db/analyses";
import { listJds, saveJd } from "@/app/_lib/db/jobs";
import { listJobRoleMeta, listJobStatuses } from "@/app/_lib/job-ingest";
import { jdJobId, validateJdFields } from "@/app/_lib/jd-limits";
import { safeJsonError } from "@/app/_lib/api-response";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";


export async function GET() {
  try {
    const ws = await currentWorkspace();
    const rows = listJds(200, ws);
    // W8-3 (JDL3) — each row's linked-job status (one query for all rows): the
    // library can show which JDs are matchable and offer "Ingest as job" on the
    // rest. null = no jd-<slug> job exists yet (analysis-only JD).
    const statuses = listJobStatuses(ws);
    // Privacy relocation (biz-ui scan 2026-06-12 #1) — each row's analyzed-
    // candidate count (one GROUP BY for all rows) feeds the Library tab's
    // "Candidates (N)" toggle. Scoped to the caller's workspace like listJds above:
    // a bare countAnalysesByJd() defaulted to the DEFAULT workspace, so every team
    // would have seen the default tenant's candidate counts (the latent bug the scan
    // flagged) once multi-workspace is enabled.
    const counts = countAnalysesByJd(ws);
    // The linked jd-<slug> job's role family + seniority (one query for all rows)
    // feed the library's Field and Seniority columns; an analysis-only JD with no
    // job behind it has neither and renders "—".
    const roleMeta = listJobRoleMeta(ws);
    const jds = rows.map((row) => {
      const jobId = jdJobId(row.slug);
      const meta = roleMeta[jobId];
      return {
        ...row,
        jobStatus: statuses[jobId] ?? null,
        analysisCount: counts[row.slug] ?? 0,
        roleFamily: meta?.roleFamily ?? null,
        seniority: meta?.seniority ?? null,
        company: meta?.company ?? null,
      };
    });
    return NextResponse.json({ jds });
  } catch (error) {
    return safeJsonError(error, "api:jds", "JD_LIST_FAILED");
  }
}

export async function POST(request: Request) {
  // Writing a JD to the library is a recruiter action, not a public one (GET above
  // stays open). Gate before the body read. Open mode is a no-op, so dev/sim pass.
  const denied = await requireOperator();
  if (denied) return denied;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Body must be a JSON object." }, { status: 400 });
  }
  const record = body as Record<string, unknown>;
  const fields = validateJdFields(record.title, record.body);
  if (!fields.ok) {
    return NextResponse.json({ error: fields.error }, { status: 400 });
  }
  try {
    const saved = saveJd({ title: fields.title, body: fields.body }, await currentWorkspace());
    return NextResponse.json({ ...saved, title: fields.title, body: fields.body });
  } catch (error) {
    // Never forward raw SQLite text (e.g. "UNIQUE constraint failed: jds.slug")
    // — the shared safe responder logs it server-side and returns a generic
    // message + stable code instead. Every JD/template sibling routes here too.
    return safeJsonError(error, "api:jds", "JD_SAVE_FAILED");
  }
}
