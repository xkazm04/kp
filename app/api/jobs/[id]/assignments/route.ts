import { NextResponse } from "next/server";
import { listDevCasesForJob } from "@/app/_lib/db/devcase";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";

// ONE THREAD — the assignments (dev cases) cut for one job.
//
// The link this reads is dev_cases.job_id, resolved from the JD the recruiter picked
// when the case was defined. Before that column existed the pick survived only inside
// need_json, so this question — "does this role have a work sample, and which one?" —
// had no answer anywhere in the Jobs surface.
//
// A LIST projection, not the row: listDevCasesForJob returns whole cases (need /
// analysis / role / case JSON, which is the assignment's internal design and includes
// its cover probes). The Jobs strip needs a count and a label, so only identity fields
// leave here — the same discipline the public token routes state as "a projection, not
// the row", applied to an internal surface because the payload is large as well as
// sensitive.
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = await requireOperator();
  if (denied) return denied;
  const { id } = await context.params;
  try {
    // Workspace-scoped: an enumeration of a team's assignments, keyed by a job id the
    // caller supplied. The store filters on the session's workspace, never the job's.
    const cases = listDevCasesForJob(id, await currentWorkspace()).map((c) => ({
      id: c.id,
      title: c.title,
      roleTitle: c.roleTitle,
      status: c.status,
      createdAt: c.createdAt,
    }));
    return NextResponse.json({ assignments: cases });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to list assignments." },
      { status: 500 }
    );
  }
}
