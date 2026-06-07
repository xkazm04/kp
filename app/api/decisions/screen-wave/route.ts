import { NextRequest, NextResponse } from "next/server";
import { runScreenWave } from "@/app/_lib/screen-wave";
import { DecisionConfigError, validateScreeningOverride } from "@/app/_lib/decision-config-schema";

export const runtime = "nodejs";
export const maxDuration = 60;

// Run the screening auto-reject wave over one role's matched cohort. An optional
// `override` rule lets the simulation/preview run it without changing the saved
// config.
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { jobId?: string; override?: unknown };
    if (!body.jobId) return NextResponse.json({ error: "jobId is required." }, { status: 400 });
    // Validate the optional per-run override at the trust boundary: auto-reject is
    // irreversible (status change + queued candidate email), so a malformed or
    // out-of-range override is a 400 here — and the clamped result, never the raw
    // body, is what reaches runScreenWave's bottom-% math (idea-1852b219).
    const checked = validateScreeningOverride(body.override);
    if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });
    const result = await runScreenWave(body.jobId, checked.override);
    return NextResponse.json(result);
  } catch (error) {
    // runScreenWave's backstop throws DecisionConfigError on a bad override —
    // surface it as a 400 too, so a schema violation is never reported as a 500.
    if (error instanceof DecisionConfigError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Screen wave failed." }, { status: 500 });
  }
}
