import { NextResponse } from "next/server";
import { scoreOutcomeInputs } from "@/app/_lib/db/pipeline-calibration";
import { computeScoreOutcomes } from "@/app/_lib/calibration-outcomes";
import { withWorkspace } from "@/app/_lib/auth/workspace-context";
import { safeJsonError } from "@/app/_lib/api-response";

// Score validation against what people decided (calibration-outcomes.ts): the outcome
// ladder from the append-only event trail, score bands with Wilson intervals, AUC per
// score, and the confidence >= 80 auto-advance band audit. Read-only and
// workspace-scoped; it never changes a threshold or a weight.
export const GET = withWorkspace(async (ws: string) => {
  try {
    const { entries, events, confidences, axis } = scoreOutcomeInputs(ws);
    return NextResponse.json(computeScoreOutcomes(entries, events, confidences, axis));
  } catch (error) {
    return safeJsonError(error, "api:analytics:calibration:outcomes", "ANALYTICS_CALIBRATION_READ_FAILED");
  }
});
