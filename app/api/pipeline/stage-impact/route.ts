import { NextResponse } from "next/server";
import { countPipelineByStage } from "@/app/_lib/db/pipeline";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { getPipelineAxis } from "@/app/_lib/pipeline-axis-server";
import { safeJsonError } from "@/app/_lib/api-response";

// Who is standing where — the read Settings → Hiring makes before it will let a
// board column be removed.
//
// Editing the axis is the one settings change that can strand real people: drop
// a column and every candidate on it is off the board until somebody moves them.
// The composer therefore refuses to save such an edit blind. This endpoint is the
// evidence it refuses on, and it is deliberately its own route rather than a
// field on GET /api/pipeline: the board fetches that every 30 seconds and does
// not need a GROUP BY, while the composer needs it exactly twice (on load, and
// before a save).
//
// Operator-gated like the config route it serves — occupancy is aggregate, but
// it is still a read of who is in the hiring pipeline.

export async function GET() {
  const denied = await requireOperator();
  if (denied) return denied;
  try {
    const ws = await currentWorkspace();
    const counts = countPipelineByStage(ws);
    const axis = getPipelineAxis(ws);
    // The axis rides along so the caller can name a stage that is ALREADY
    // off-axis (a legacy row, a previously-retired column) rather than showing a
    // raw id beside its count.
    return NextResponse.json({ counts, stages: axis.stages, retiredStages: axis.retired });
  } catch (error) {
    return safeJsonError(error, "api:pipeline/stage-impact", "STAGE_IMPACT_FAILED");
  }
}
