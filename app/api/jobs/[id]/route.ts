import { NextResponse } from "next/server";
import { getJob, jobVisibleToWorkspace } from "@/app/_lib/db";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";

// Point-read one job by id. GET /api/jobs enumerates a ranked, LIMIT-300 slice, so a
// ?job=<id> deep link (minted by the Command Palette, the Pipeline board and the JD
// ledger) could target a role that is real but outside that slice — the Jobs tab then
// stamped its once-per-param guard and silently did nothing. This is the by-id escape
// hatch it falls back to; the payload carries the SAME status decoration listJobs
// applies, so the record drops straight into the table's Job shape.
//
// Visibility matches the list query's predicate (shared seeded corpus + this team's own
// openings) — a point-fetch must not hand out what the list would never show. 404 covers
// both "no such job" and "another team's job", so the endpoint can't be used to probe ids.
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const ws = await currentWorkspace();
    const job = getJob(id);
    if (!job || !jobVisibleToWorkspace(id, ws)) {
      return NextResponse.json({ error: "Job not found." }, { status: 404 });
    }
    return NextResponse.json({ job });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to load job." }, { status: 500 });
  }
}
