import { NextResponse } from "next/server";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { safeJsonError } from "@/app/_lib/api-response";
import { readRoleSlate } from "@/app/_lib/db/role-slate";

// GET /api/roles/[jobId]/slate — ADR-0012. The role's candidate slate: people and
// AI agents in ONE list, under the role's frozen rubric (db/role-rubrics.ts).
//
// READ-ONLY and evidence-free by design: a board open must never trigger paid
// evaluation, and each evidence producer (analysis, devcase, scorecard, agent fit)
// owns its own write path. So the caller sees WHO is on the slate, under WHICH
// rubric version each was last judged, and which are stale — no fabricated score.
//
// Operator-gated: a slate names candidates, so it is recruiter-facing only. No
// capability-token variant exists on purpose.
export async function GET(_request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const denied = await requireOperator();
  if (denied) return denied;
  try {
    const { jobId } = await params;
    const ws = await currentWorkspace();
    const slate = readRoleSlate(jobId, new Map(), ws);
    return NextResponse.json({
      jobId: slate.jobId,
      // Projected, not serialized: the axes ARE the recruiter-visible standard,
      // the store row's internals stay server-side.
      rubric: slate.rubric
        ? {
            version: slate.rubric.version,
            axes: slate.rubric.axes,
            source: slate.rubric.source,
            frozenAt: slate.rubric.frozenAt,
          }
        : null,
      members: slate.members.map((m) => ({
        entryId: m.entryId,
        population: m.population,
        label: m.label,
        stage: m.stage,
        status: m.status,
        evaluatedAgainstVersion: m.evaluatedAgainstVersion,
      })),
      staleMemberIds: slate.staleMemberIds,
    });
  } catch (error) {
    return safeJsonError(error, "api:roles/slate", "ROLE_SLATE_FAILED");
  }
}
