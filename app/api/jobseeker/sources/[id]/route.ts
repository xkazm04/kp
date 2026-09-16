import { NextResponse } from "next/server";
import { jsonRefusal, safeJsonError, requireCapabilityCoded } from "@/app/_lib/api-response";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { requireCapability } from "@/app/_lib/auth/current-user";
import { getJobseekerSource, pauseSource, resumeSource, setSourceEnabled, setSourceRules } from "@/app/_lib/db/jobseeker-sources";
import { isRulesError, validateRules } from "@/app/_lib/jobseeker/rules/dsl";
import { termsHashForSource } from "@/app/_lib/jobseeker/sources-catalog";
import { PAUSE_REASONS, type PauseReason } from "@/app/_lib/jobseeker/types";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";

// PATCH /api/jobseeker/sources/[id] — the owner's controls on one source:
//   { enabled?, acknowledge?: true, pause?: PauseReason, resume?: true, rules?, rulesBaseline? }
// Tier B + enabled:true needs the acknowledgement of the CURRENT terms hash (in this
// request, or already recorded) → else 409 JOBSEEKER_SOURCE_NOT_ACKNOWLEDGED. Tier C
// is 403 whatever the body. `rules` are validated (400 JOBSEEKER_RULES_INVALID) and
// written together with their preview baseline.

type PatchBody = { enabled?: unknown; acknowledge?: unknown; pause?: unknown; resume?: unknown; rules?: unknown; rulesBaseline?: unknown };

function isPauseReason(v: unknown): v is PauseReason {
  return typeof v === "string" && (PAUSE_REASONS as readonly string[]).includes(v);
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const denied = await requireOperator();
  if (denied) return denied;
  // The seeker's own data, but still a WRITE behind a seat: a viewer seat may read the
  // feed, not spend a scan, a model turn or a source acknowledgement (route-capability-coverage).
  const under = await requireCapabilityCoded("pipeline:write", requireCapability);
  if (under) return under;
  if (!rateLimit(`jobseeker-sources-write:${clientIpFrom(request.headers)}`, { limit: 60, windowMs: 10 * 60_000 })) {
    return jsonRefusal("TOO_MANY_REQUESTS", 429);
  }
  try {
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as PatchBody;
    const ws = await currentWorkspace();
    const source = getJobseekerSource(id, ws);
    if (!source) return jsonRefusal("JOBSEEKER_SOURCE_NOT_FOUND", 404);
    if (source.tier === "C") return jsonRefusal("JOBSEEKER_SOURCE_REFUSED", 403);

    if (body.rules !== undefined) {
      const rules = validateRules(body.rules);
      if (isRulesError(rules)) return jsonRefusal("JOBSEEKER_RULES_INVALID", 400, { detail: rules.error });
      const baseline = body.rulesBaseline;
      if (!baseline || typeof baseline !== "object" || Array.isArray(baseline) || !Object.values(baseline as Record<string, unknown>).every((n) => typeof n === "number")) {
        // Rules are persisted only WITH the baseline their preview measured (store contract).
        return jsonRefusal("JOBSEEKER_RULES_INVALID", 400, { detail: "rulesBaseline: the preview's per-field match counts are required" });
      }
      setSourceRules(id, rules, baseline as Record<string, number>, ws);
    }

    if (body.enabled === true) {
      const termsHash = termsHashForSource(source);
      const acknowledgedNow = body.acknowledge === true;
      const alreadyCurrent = source.acknowledgedTermsHash === termsHash;
      if (source.tier === "B" && !acknowledgedNow && !alreadyCurrent) {
        return jsonRefusal("JOBSEEKER_SOURCE_NOT_ACKNOWLEDGED", 409, { termsHash });
      }
      setSourceEnabled(id, true, source.tier === "B" && acknowledgedNow ? { termsHash } : null, ws);
    } else if (body.enabled === false) {
      setSourceEnabled(id, false, null, ws);
    }

    if (isPauseReason(body.pause)) pauseSource(id, body.pause, ws);
    if (body.resume === true) resumeSource(id, ws);

    return NextResponse.json({ source: getJobseekerSource(id, ws) });
  } catch (error) {
    return safeJsonError(error, "api:jobseeker/sources/[id]", "JOBSEEKER_STORE_FAILED");
  }
}
