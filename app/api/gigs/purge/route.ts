import { NextResponse } from "next/server";
import { jsonRefusal, safeJsonError, requireCapabilityCoded } from "@/app/_lib/api-response";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { requireCapability } from "@/app/_lib/auth/current-user";
import { runGigPurge } from "@/app/_lib/gigs/purge";
import { isGigPurgeRule, type GigPurgeRule } from "@/app/_lib/gigs/reward-floor";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";

// POST /api/gigs/purge { rules: ("no_reward" | "below_floor")[], dryRun?: boolean } - remove
// the gigs the reward rules exclude (gigs/reward-floor.ts: no stated reward in any arena; a
// freelance gig whose budget ceiling is under $50, or whose top rate is under $10/hr, in USD),
// any status, with their plans, attempts and gig personas (gigs/purge.ts). The scan applies
// the same rules, so a purged gig is not filed again.
//
// DRY RUN BY DEFAULT: without `dryRun: false` nothing is written.
//   200 { dryRun, rules, count, byRule, byStatus, byArena, sample (first 20), unconverted, fx,
//         children, keptWithOutcome, filesLeft }
//       and on a real run also { deleted, changed, personasRetired, personasFailed }
//   400 GIG_INPUT_INVALID { field: "rules" | "dryRun" }
//   409 GIG_ACTION_NOT_ALLOWED { reason: "purge_running" } - one purge per workspace at a time
//   500 GIG_STORE_FAILED
// Files on disk (workdirs, reports, proposals) are never touched; `filesLeft` counts them.
//
// Operator-gated + `pipeline:write`, and throttled per IP BEFORE the work: a run reads the USD
// rate table (one outbound request) and deletes in bulk. 5/10min.

const running = new Set<string>();

export async function POST(request: Request): Promise<NextResponse> {
  const denied = await requireOperator();
  if (denied) return denied;
  const under = await requireCapabilityCoded("pipeline:write", requireCapability);
  if (under) return under;
  if (!rateLimit(`gigs-purge:${clientIpFrom(request.headers)}`, { limit: 5, windowMs: 10 * 60_000 })) {
    return jsonRefusal("TOO_MANY_REQUESTS", 429);
  }
  const body = (await request.json().catch(() => null)) as { rules?: unknown; dryRun?: unknown } | null;
  const rawRules = body && typeof body === "object" ? body.rules : undefined;
  if (!Array.isArray(rawRules) || rawRules.length === 0 || rawRules.length > 4 || !rawRules.every(isGigPurgeRule)) {
    return jsonRefusal("GIG_INPUT_INVALID", 400, { field: "rules" });
  }
  const rawDry = body?.dryRun;
  if (rawDry !== undefined && typeof rawDry !== "boolean") return jsonRefusal("GIG_INPUT_INVALID", 400, { field: "dryRun" });
  const rules = rawRules as GigPurgeRule[];
  const dryRun = rawDry !== false;
  let ws: string | null = null;
  try {
    ws = await currentWorkspace();
    if (running.has(ws)) {
      ws = null;
      return jsonRefusal("GIG_ACTION_NOT_ALLOWED", 409, { reason: "purge_running" });
    }
    running.add(ws);
    const report = await runGigPurge(ws, { rules, dryRun });
    return NextResponse.json(report);
  } catch (error) {
    return safeJsonError(error, "api:gigs/purge", "GIG_STORE_FAILED");
  } finally {
    if (ws) running.delete(ws);
  }
}
