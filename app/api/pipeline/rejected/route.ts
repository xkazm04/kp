import { NextRequest, NextResponse } from "next/server";
import { jsonRefusal, safeJsonError } from "@/app/_lib/api-response";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { boardEntryView, listRejectedForLane } from "@/app/_lib/db/pipeline";
import { withCanonicalScoresCached } from "@/app/_lib/pipeline-score-cache";
import { withTransferScores } from "@/app/_lib/pipeline-transfer-score";

// GET /api/pipeline/rejected?lane=<job id | job title>
// Request: `lane` — the board lane key (`entryLaneKey`: job id, else job title).
// Response: { rejected: { entry: BoardEntry, rejectedStage: string|null, rejectedAt: string|null, auto: boolean }[] }
//
// The board's rejected shelf: every candidate this lane has rejected, with the column
// they were rejected at. The board payload deliberately excludes rejected rows, so the
// Subway's first-column count opens this on demand. Operator-gated like every other
// per-candidate pipeline read — these are named people and closed decisions.
export async function GET(request: NextRequest) {
  const denied = await requireOperator();
  if (denied) return denied;
  const lane = request.nextUrl.searchParams.get("lane")?.trim() ?? "";
  if (!lane) return jsonRefusal("PIPELINE_LANE_REQUIRED", 400);
  try {
    const ws = await currentWorkspace();
    // Same score stamps the board rows carry, so a rejected ticket shows the score the
    // candidate was judged on rather than a bare snapshot.
    const items = listRejectedForLane(lane, ws);
    const stamped = withTransferScores(withCanonicalScoresCached(items.map((r) => r.entry), ws), ws);
    const rejected = items.map((r, i) => ({ ...r, entry: boardEntryView(stamped[i]) }));
    return NextResponse.json({ rejected });
  } catch (error) {
    return safeJsonError(error, "api:pipeline/rejected", "PIPELINE_LIST_FAILED");
  }
}
