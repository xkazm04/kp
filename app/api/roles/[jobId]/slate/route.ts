import { NextResponse } from "next/server";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { jsonRefusal, safeJsonError } from "@/app/_lib/api-response";
import { readRoleSlate } from "@/app/_lib/db/role-slate";

// GET /api/roles/[jobId]/slate — ADR-0009. The role's candidate slate: people
// and AI agents in ONE list, each carrying the same evaluation fields against
// the role's frozen rubric.
//
// READ-ONLY and evidence-free by design. This route does NOT score anybody: a
// board open must never trigger paid evaluation (the promote route is throttled
// precisely because it can), and the producers of candidate evidence — the CV
// matcher, the interview scorecard, the agent coverage assessment — each own
// their own write path. So every member comes back with `evaluation: null` and
// the caller sees WHO is on the slate, under WHICH rubric version each was last
// judged, and which of them are stale. That is the honest read; a fabricated
// evaluation computed here would be worse than none.
//
// Operator-gated: a slate names candidates, so it is recruiter-facing, never
// candidate-facing. No capability-token variant of this route exists on purpose.
export async function GET(_request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const denied = await requireOperator();
  if (denied) return denied;
  try {
    const { jobId } = await params;
    if (!jobId) return jsonRefusal("ROLE_NOT_FOUND", 404);
    const ws = await currentWorkspace();
    const slate = readRoleSlate(jobId, new Map(), ws);
    return NextResponse.json({
      jobId: slate.jobId,
      // The active rubric is projected, not serialized wholesale: the criteria
      // ARE the recruiter-visible standard (that visibility is the point), but
      // the store row's internals stay server-side.
      rubric: slate.rubric
        ? {
            version: slate.rubric.version,
            criteriaHash: slate.rubric.criteriaHash,
            criteria: slate.rubric.criteria,
            frozenAt: slate.rubric.frozenAt,
            source: slate.rubric.source,
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
