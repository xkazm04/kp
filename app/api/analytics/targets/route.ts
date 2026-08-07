import { NextRequest, NextResponse } from "next/server";
import { RECRUITER_HOURLY_TARGET_KEY, setAnalyticsTarget, TIME_TO_HIRE_TARGET_KEY } from "@/app/_lib/db/analytics";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { FUNNEL_STAGES } from "@/app/_lib/pipeline-stages";


// 82c2b8e8 / b39992b1 — recruiter-set analytics settings (mirrors
// /api/analytics/spend). A metric is a funnel stage name (conversion % goal,
// 0–100), the reserved time_to_hire key (goal in days), or the reserved
// recruiter_hourly_czk key (ROI rate). A null/empty value clears it.
const VALID_METRICS = new Set<string>([...FUNNEL_STAGES, TIME_TO_HIRE_TARGET_KEY, RECRUITER_HOURLY_TARGET_KEY]);
const MAX_DAYS = 3650; // sanity ceiling, not a business rule
const MAX_HOURLY_CZK = 1_000_000; // sanity ceiling, not a business rule

export async function POST(request: NextRequest) {
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
      // Conversion goals are a percentage; time-to-hire is days; the rate is CZK.
      const ceiling =
        metric === TIME_TO_HIRE_TARGET_KEY ? MAX_DAYS : metric === RECRUITER_HOURLY_TARGET_KEY ? MAX_HOURLY_CZK : 100;
      if (value > ceiling) {
        return NextResponse.json({ error: "Value out of range." }, { status: 400 });
      }
    }
    setAnalyticsTarget(metric, value, await currentWorkspace());
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save the target." },
      { status: 500 }
    );
  }
}
