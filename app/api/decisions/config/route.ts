import { NextRequest, NextResponse } from "next/server";
import { getAllDecisionConfigs, setDecisionConfig } from "@/app/_lib/decision-config-store";
import { DecisionConfigError, validateDecisionConfig } from "@/app/_lib/decision-config-schema";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { jsonRefusal, safeJsonError } from "@/app/_lib/api-response";


// Read / update the per-phase decision rules (Phase 3 decision module config).
// Operator-gated (backlog #30 / SD-L1-010): these rules drive the auto-reject
// wave, so both the read and the write re-verify the session at the handler
// (and reject the anonymous demo session) like the rest of /api/decisions/*.
export async function GET() {
  const denied = await requireOperator();
  if (denied) return denied;
  // The team's EFFECTIVE policy per phase: its own override where set, else the org default.
  return NextResponse.json({ configs: getAllDecisionConfigs(await currentWorkspace()) });
}

export async function POST(request: NextRequest) {
  const denied = await requireOperator();
  if (denied) return denied;
  try {
    const ws = await currentWorkspace();
    const body = (await request.json()) as { phase?: unknown; config?: unknown; scope?: unknown };
    if (body.phase === undefined || body.config === undefined) {
      return jsonRefusal("DECISION_CONFIG_FIELDS_REQUIRED", 400);
    }
    // Validate + clamp at the boundary: a malformed body (wrong type, stray key,
    // unknown phase) is a 400, and out-of-range 0–100 fields are clamped rather
    // than persisted verbatim into runScreenWave's math (idea-55baa5da).
    const result = validateDecisionConfig(body.phase, body.config);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    // scope 'team' writes THIS team's override; default 'org' edits the company baseline
    // (the historical behavior). Publishing the org default affects every team — gate it on
    // a manage capability once RBAC is enforced (today operator-gated, single-tenant).
    const scope = body.scope === "team" ? "team" : "org";
    setDecisionConfig(result.phase, result.config, ws, scope);
    return NextResponse.json({ ok: true, configs: getAllDecisionConfigs(ws) });
  } catch (error) {
    // The store's backstop throws DecisionConfigError on a bad write — surface it
    // as a 400 too, so a schema violation is never reported as a 500.
    if (error instanceof DecisionConfigError) {
      // The backstop's own prose stays server-side: the route already validated,
      // so reaching here means a caller found a path around that — the client
      // gets the code, the detail goes to the log.
      console.error("[api:decisions/config] DECISION_CONFIG_INVALID", error);
      return jsonRefusal("DECISION_CONFIG_INVALID", 400);
    }
    return safeJsonError(error, "api:decisions/config", "DECISION_CONFIG_SAVE_FAILED");
  }
}
