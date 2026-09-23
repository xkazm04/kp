import { NextRequest, NextResponse } from "next/server";
import { setAnalyticsTarget } from "@/app/_lib/db/analytics";
import { validateTargetWrite } from "@/app/_lib/analytics-target-keys";
import { getPipelineAxis } from "@/app/_lib/pipeline-axis-server";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { can } from "@/app/_lib/auth/current-user";
import { jsonRefusal, safeJsonError } from "@/app/_lib/api-response";
import { invalidateAnalyticsWorkspace } from "@/app/_lib/analytics-cache";


// 82c2b8e8 / b39992b1 — recruiter-set analytics settings (mirrors
// /api/analytics/spend). A metric is a conversion % goal for a column on THIS
// workspace's live board (0–100), the reserved time_to_hire key (goal in days), or
// one of the two ROI inputs (recruiter_hourly_czk, manual_hours_per_hire).
//
// CLEARING: a null/empty value clears the goal — AND SO DOES `0`. This route accepts 0
// (it only refuses negatives) and hands it to setAnalyticsTarget, which DELETEs the row
// on any non-positive value and answers 200 either way, exactly like setChannelSpend
// behind /api/analytics/spend. The comment here used to name only null/empty, so a
// posted `0` looked like "goal = 0 %" to a reader of this file while the store read it
// as "no goal": a 40 % conversion target overwritten with 0 comes back as an absent goal
// line, not a zero one. The inline editor normalizes 0 → null before posting for the same
// reason (AnalyticsInlineNumberSave) — this states the rule the store actually enforces.
//
// THE KEY SPACE is app/_lib/analytics-target-keys.ts, derived from the workspace's
// own stage axis plus the reserved keys — the same registry db/analytics.ts filters
// the payload through. This route used to validate against the SHIPPED five stage
// names (FUNNEL_STAGES) while the funnel and the goals editor drew the workspace's
// own columns, so a team that added a column was shown a goal field whose every save
// answered a raw English "Invalid metric." with no code. Refusals are now codes:
// ANALYTICS_TARGET_UNKNOWN_METRIC (unknown, retired, or the entry column) and
// ANALYTICS_TARGET_OUT_OF_RANGE (not a finite non-negative number, or over the key's
// ceiling). UAT KAT-L1-005's rule still holds: the reserved keys are DERIVED, so
// adding one in the registry cannot leave it readable-but-unsettable here.

// AUTHORITY (2026-09-03) — same story as /api/analytics/spend, which this route
// mirrors: no gate at all, so any seat could move the goal lines every board is
// judged against (and the ROI baseline the automation claim divides by). Session
// first (401), then `pipeline:write` (403 with a code).
export async function POST(request: NextRequest) {
  const denied = await requireOperator();
  if (denied) return denied;
  if (!(await can("pipeline:write"))) return jsonRefusal("ANALYTICS_POLICY_FORBIDDEN", 403);
  try {
    const body = (await request.json().catch(() => ({}))) as { metric?: unknown; value?: unknown };
    const ws = await currentWorkspace();
    const verdict = validateTargetWrite(body, getPipelineAxis(ws).stages);
    if (!verdict.ok) return jsonRefusal(verdict.code, 400);
    setAnalyticsTarget(verdict.metric, verdict.value, ws);
    // The goal line is IN the /api/analytics payload (`targets`), and the inline
    // editor reloads that payload the instant this returns — inside the read memo's
    // TTL. Without this the recruiter watches the panel refresh and reads back the
    // goal they just replaced, with nothing on screen saying the number is stale.
    invalidateAnalyticsWorkspace(ws);
    return NextResponse.json({ ok: true });
  } catch (error) {
    // setAnalyticsTarget writes straight through better-sqlite3 — the thrown message
    // carries constraint text and the absolute db path.
    return safeJsonError(error, "api:analytics/targets", "ANALYTICS_TARGET_SAVE_FAILED");
  }
}
