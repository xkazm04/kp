import { NextResponse } from "next/server";
import { countAnalysesByJd, listJds, saveJd } from "@/app/_lib/db";
import { listJobStatuses } from "@/app/_lib/job-ingest";
import { validateJdFields } from "@/app/_lib/jd-limits";
import { safeJsonError } from "@/app/_lib/api-response";

export const runtime = "nodejs";

export async function GET() {
  try {
    const rows = listJds(200);
    // W8-3 (JDL3) — each row's linked-job status (one query for all rows): the
    // library can show which JDs are matchable and offer "Ingest as job" on the
    // rest. null = no jd-<slug> job exists yet (analysis-only JD).
    const statuses = listJobStatuses();
    // Privacy relocation (biz-ui scan 2026-06-12 #1) — each row's analyzed-
    // candidate count (one GROUP BY for all rows) feeds the Library tab's
    // "Candidates (N)" toggle, which replaced the public JD page's aside.
    const counts = countAnalysesByJd();
    const jds = rows.map((row) => ({
      ...row,
      jobStatus: statuses[`jd-${row.slug}`] ?? null,
      analysisCount: counts[row.slug] ?? 0,
    }));
    return NextResponse.json({ jds });
  } catch (error) {
    return safeJsonError(error, "api:jds", "JD_LIST_FAILED");
  }
}

export async function POST(request: Request) {
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
    const saved = saveJd({ title: fields.title, body: fields.body });
    return NextResponse.json({ ...saved, title: fields.title, body: fields.body });
  } catch (error) {
    // Never forward raw SQLite text (e.g. "UNIQUE constraint failed: jds.slug")
    // — the shared safe responder logs it server-side and returns a generic
    // message + stable code instead. Every JD/template sibling routes here too.
    return safeJsonError(error, "api:jds", "JD_SAVE_FAILED");
  }
}
