import { NextRequest, NextResponse } from "next/server";
import {
  DecisionConfigStaleError,
  getAllDecisionConfigs,
  getAllDecisionConfigVersions,
  setDecisionConfig,
} from "@/app/_lib/decision-config-store";
import { DecisionConfigError, validateDecisionConfig } from "@/app/_lib/decision-config-schema";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { jsonRefusal, safeJsonError } from "@/app/_lib/api-response";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";

// A rules write is cheap but it is the AUTO-REJECT gate: unbounded POSTs from one
// address are a policy-flapping door, and open mode makes the operator gate above a
// no-op. Placed after the cheap refusals so a malformed body costs no budget.
const CONFIG_RATE_LIMIT = { limit: 60, windowMs: 10 * 60_000 };


// Read / update the per-phase decision rules (Phase 3 decision module config).
// Operator-gated (backlog #30 / SD-L1-010): these rules drive the auto-reject
// wave, so both the read and the write re-verify the session at the handler
// (and reject the anonymous demo session) like the rest of /api/decisions/*.
export async function GET() {
  const denied = await requireOperator();
  if (denied) return denied;
  // The team's EFFECTIVE policy per phase: its own override where set, else the org default.
  // `versions` rides along: the concurrency token a client echoes on POST so its save can
  // be dropped rather than silently overwrite one that landed while it was editing.
  const ws = await currentWorkspace();
  return NextResponse.json({ configs: getAllDecisionConfigs(ws), versions: getAllDecisionConfigVersions(ws) });
}

export async function POST(request: NextRequest) {
  const denied = await requireOperator();
  if (denied) return denied;
  try {
    const ws = await currentWorkspace();
    const body = (await request.json()) as { phase?: unknown; config?: unknown; scope?: unknown; expectedUpdatedAt?: unknown };
    if (body.phase === undefined || body.config === undefined) {
      return jsonRefusal("DECISION_CONFIG_FIELDS_REQUIRED", 400);
    }
    // Validate + clamp at the boundary: a malformed body (wrong type, stray key,
    // unknown phase) is a 400, and out-of-range 0–100 fields are clamped rather
    // than persisted verbatim into runScreenWave's math (idea-55baa5da).
    const result = validateDecisionConfig(body.phase, body.config);
    // The validator's own detail rides as DATA beside the code: it names a field the
    // operator editing the rules needs, but it is English prose and must never be the
    // thing the UI paints.
    if (!result.ok) {
      return jsonRefusal("DECISION_CONFIG_INVALID", 400, { detail: result.error });
    }
    // scope 'team' writes THIS team's override; default 'org' edits the company baseline
    // (the historical behavior). Publishing the org default affects every team — gate it on
    // a manage capability once RBAC is enforced (today operator-gated, single-tenant).
    const scope = body.scope === "team" ? "team" : "org";
    if (!rateLimit(`decision-config:${clientIpFrom(request.headers)}`, CONFIG_RATE_LIMIT)) {
      return jsonRefusal("TOO_MANY_REQUESTS", 429);
    }
    // Optimistic concurrency, opt-in per client: a caller that READ the config echoes the
    // version it read (GET's `versions`), and the store re-asserts it under the write lock.
    // A caller that omits the field computes the whole config server-side and has no read
    // to be stale about.
    const expectedUpdatedAt =
      typeof body.expectedUpdatedAt === "string" || body.expectedUpdatedAt === null
        ? (body.expectedUpdatedAt as string | null)
        : undefined;
    setDecisionConfig(result.phase, result.config, ws, scope, { expectedUpdatedAt });
    return NextResponse.json({ ok: true, configs: getAllDecisionConfigs(ws), versions: getAllDecisionConfigVersions(ws) });
  } catch (error) {
    // Somebody saved first. Nothing was written, so the remedy is to reload and decide
    // against what the plan now says — never to merge a draft built on a plan that is gone.
    if (error instanceof DecisionConfigStaleError) return jsonRefusal("DECISION_CONFIG_STALE", 409);
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
