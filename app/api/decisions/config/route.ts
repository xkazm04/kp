import { NextRequest, NextResponse } from "next/server";
import { getAllDecisionConfigs, setDecisionConfig } from "@/app/_lib/decision-config-store";

export const runtime = "nodejs";

// Read / update the per-phase decision rules (Phase 3 decision module config).
export async function GET() {
  return NextResponse.json({ configs: getAllDecisionConfigs() });
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { phase?: string; config?: Record<string, unknown> };
    if (!body.phase || !body.config) {
      return NextResponse.json({ error: "phase and config are required." }, { status: 400 });
    }
    setDecisionConfig(body.phase, body.config);
    return NextResponse.json({ ok: true, configs: getAllDecisionConfigs() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to save config." }, { status: 500 });
  }
}
