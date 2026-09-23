import { NextResponse } from "next/server";
import { jsonRefusal, safeJsonError } from "@/app/_lib/api-response";
import { can } from "@/app/_lib/auth/current-user";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { liveScreeningRecommendation } from "@/app/_lib/calibration-recommendation";
import { previewFloorMove } from "@/app/_lib/floor-move-preview";
import { ROLE_FAMILY_SLUGS } from "@/app/_lib/role-families";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";

// THROTTLE. One preview = the two calibration scans apply-threshold spends PLUS two
// screening-wave dry runs per role with an active Screened cohort. 30/10min per IP: a
// recruiter previewing a floor per role family in one sitting stays far under it.
const FLOOR_PREVIEW_RATE_LIMIT = { limit: 30, windowMs: 10 * 60_000 };

// Before Apply, who on today's board does the floor move reach? (challenge-r08
// cv-analysis-archetypes/B). A READ that writes nothing (floor-move-preview.ts runs the
// wave's own dry run), but it names candidates and previews a policy change, so it sits
// behind the SAME seat as the write it previews: operator + `pipeline:write`, refused
// with a CODE. Not in public-routes.ts.
//
// The previewed threshold is never the client's: it is re-derived by the one helper the
// display route and apply-threshold share, so the people named here are the people the
// number Apply writes would move. No live recommendation -> the existing 409.
export async function GET(request: Request) {
  const denied = await requireOperator();
  if (denied) return denied;
  if (!(await can("pipeline:write"))) return jsonRefusal("ANALYTICS_POLICY_FORBIDDEN", 403);
  try {
    const raw = new URL(request.url).searchParams.get("roleFamily");
    let roleFamily: string | null = null;
    if (raw) {
      if (!(ROLE_FAMILY_SLUGS as readonly string[]).includes(raw)) return jsonRefusal("CALIBRATION_FAMILY_UNKNOWN", 400);
      roleFamily = raw;
    }

    if (!rateLimit(`floor-preview:${clientIpFrom(request.headers)}`, FLOOR_PREVIEW_RATE_LIMIT)) {
      return jsonRefusal("TOO_MANY_REQUESTS", 429);
    }

    const ws = await currentWorkspace();
    const { recommendation } = liveScreeningRecommendation(ws, roleFamily);
    if (!recommendation) return jsonRefusal("CALIBRATION_RECOMMENDATION_ABSENT", 409);

    const preview = await previewFloorMove(ws, { suggestedThreshold: recommendation.suggestedThreshold, roleFamily });
    return NextResponse.json(preview);
  } catch (error) {
    // The preview IS the screening wave's dry run, so a fault here is that wave's fault
    // and answers its existing code (no new catalog entry for the same failure).
    return safeJsonError(error, "api:analytics/calibration/floor-preview", "SCREEN_WAVE_FAILED");
  }
}
