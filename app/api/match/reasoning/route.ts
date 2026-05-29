import { NextRequest, NextResponse } from "next/server";
import { ReasoningError, runReasoning, type ReasoningInput } from "@/app/_lib/reasoning-run";

export const runtime = "nodejs";

// Synchronous convenience wrapper. The hardened/background path is /api/tasks
// with kind "reasoning" (tracked, dedup'd, refresh-safe); both share runReasoning.
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as ReasoningInput;
    const data = await runReasoning(body);
    return NextResponse.json(data);
  } catch (error) {
    if (error instanceof ReasoningError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Reasoning failed." }, { status: 500 });
  }
}
