import { NextRequest, NextResponse } from "next/server";
import {
  MANUAL_HOURS_TARGET_KEY,
  RECRUITER_HOURLY_TARGET_KEY,
  RESERVED_TARGET_KEYS,
  setAnalyticsTarget,
  TIME_TO_HIRE_TARGET_KEY,
} from "@/app/_lib/db/analytics";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { FUNNEL_STAGES } from "@/app/_lib/pipeline-stages";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { can } from "@/app/_lib/auth/current-user";
import { jsonRefusal, safeJsonError } from "@/app/_lib/api-response";
import { invalidateAnalyticsWorkspace } from "@/app/_lib/analytics-cache";


// 82c2b8e8 / b39992b1 — recruiter-set analytics settings (mirrors
// /api/analytics/spend). A metric is a funnel stage name (conversion % goal,
// 0–100), the reserved time_to_hire key (goal in days), or the reserved
// recruiter_hourly_czk key (ROI rate).
//
// CLEARING: a null/empty value clears the goal — AND SO DOES `0`. This route accepts 0
// (it only refuses negatives) and hands it to setAnalyticsTarget, which DELETEs the row
// on any non-positive value and answers 200 either way, exactly like setChannelSpend
// behind /api/analytics/spend. The comment here used to name only null/empty, so a
// posted `0` looked like "goal = 0 %" to a reader of this file while the store read it
// as "no goal": a 40 % conversion target overwritten with 0 comes back as an absent goal
// line, not a zero one. The inline editor normalizes 0 → null before posting for the same
// reason (AnalyticsInlineNumberSave) — this states the rule the store actually enforces.
// UAT KAT-L1-005 — DERIVED from RESERVED_TARGET_KEYS, not hand-listed. The
// hand-written list is why `manual_hours_per_hire` was readable but unsettable:
// db/analytics.ts threaded the key into automationRoi's fourth parameter, and this
// validator (which never heard of it) rejected every attempt to save one, so the ROI
// claim stayed pinned to the shipped 42-hour constant that no org could re-ground in
// its own baseline. Adding a reserved key in one place can no longer leave it
// unsettable in another.
const VALID_METRICS = new Set<string>([...FUNNEL_STAGES, ...RESERVED_TARGET_KEYS]);
const MAX_DAYS = 3650; // sanity ceiling, not a business rule
const MAX_HOURLY_CZK = 1_000_000; // sanity ceiling, not a business rule
const MAX_MANUAL_HOURS = 1000; // sanity ceiling, not a business rule

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
    const metric = String(body.metric ?? "").trim();
    if (!VALID_METRICS.has(metric)) {
      return NextResponse.json({ error: "Invalid metric." }, { status: 400 });
    }
    const raw = body.value;
    const value = raw == null || raw === "" ? null : Number(raw);
    if (value !== null) {
      if (!Number.isFinite(value) || value < 0) {
        return NextResponse.json({ error: "Invalid value." }, { status: 400 });
      }
      // Conversion goals are a percentage; time-to-hire is days; the rate is CZK;
      // the manual baseline is hours per hire.
      const ceiling =
        metric === TIME_TO_HIRE_TARGET_KEY
          ? MAX_DAYS
          : metric === RECRUITER_HOURLY_TARGET_KEY
            ? MAX_HOURLY_CZK
            : metric === MANUAL_HOURS_TARGET_KEY
              ? MAX_MANUAL_HOURS
              : 100;
      if (value > ceiling) {
        return NextResponse.json({ error: "Value out of range." }, { status: 400 });
      }
    }
    const ws = await currentWorkspace();
    setAnalyticsTarget(metric, value, ws);
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
