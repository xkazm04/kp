import { NextRequest, NextResponse } from "next/server";
import { getAllDecisionConfigs, setDecisionConfig } from "@/app/_lib/decision-config-store";
import { DecisionConfigError, validateDecisionConfig } from "@/app/_lib/decision-config-schema";
import { requireOperator } from "@/app/_lib/auth/require-operator";


// Read / update the per-phase decision rules (Phase 3 decision module config).
// Operator-gated (backlog #30 / SD-L1-010): these rules drive the auto-reject
// wave, so both the read and the write re-verify the session at the handler
// (and reject the anonymous demo session) like the rest of /api/decisions/*.
export async function GET() {
  const denied = await requireOperator();
  if (denied) return denied;
  return NextResponse.json({ configs: getAllDecisionConfigs() });
}

export async function POST(request: NextRequest) {
  const denied = await requireOperator();
  if (denied) return denied;
  try {
    const body = (await request.json()) as { phase?: unknown; config?: unknown };
    if (body.phase === undefined || body.config === undefined) {
      return NextResponse.json({ error: "phase and config are required." }, { status: 400 });
    }
    // Validate + clamp at the boundary: a malformed body (wrong type, stray key,
    // unknown phase) is a 400, and out-of-range 0–100 fields are clamped rather
    // than persisted verbatim into runScreenWave's math (idea-55baa5da).
    const result = validateDecisionConfig(body.phase, body.config);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    setDecisionConfig(result.phase, result.config);
    return NextResponse.json({ ok: true, configs: getAllDecisionConfigs() });
  } catch (error) {
    // The store's backstop throws DecisionConfigError on a bad write — surface it
    // as a 400 too, so a schema violation is never reported as a 500.
    if (error instanceof DecisionConfigError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to save config." }, { status: 500 });
  }
}
