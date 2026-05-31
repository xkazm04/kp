import { NextRequest, NextResponse } from "next/server";
import { runScreenWave } from "@/app/_lib/screen-wave";
import type { ScreeningRule } from "@/app/_lib/decision-config-store";

export const runtime = "nodejs";
export const maxDuration = 60;

// Run the screening auto-reject wave over one role's matched cohort. An optional
// `override` rule lets the simulation/preview run it without changing the saved
// config.
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { jobId?: string; override?: Partial<ScreeningRule> };
    if (!body.jobId) return NextResponse.json({ error: "jobId is required." }, { status: 400 });
    const result = await runScreenWave(body.jobId, body.override);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Screen wave failed." }, { status: 500 });
  }
}
