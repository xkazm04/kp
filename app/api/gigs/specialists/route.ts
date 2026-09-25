import { NextRequest, NextResponse } from "next/server";
import { jsonRefusal, safeJsonError, requireCapabilityCoded } from "@/app/_lib/api-response";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { requireCapability } from "@/app/_lib/auth/current-user";
import { getHiredAgent, type HiredAgentRecord } from "@/app/_lib/db/agents";
import { listGigSpecialists } from "@/app/_lib/db/gigs-specialists";
import { hireGigSpecialist } from "@/app/_lib/gigs/specialist";
import { isGigArena } from "@/app/_lib/gigs/types";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";

// /api/gigs/specialists - the workspace's gig specialists and the door that hires one.
// GET  -> { specialists: [{ ...GigSpecialist, hire: { id, status, personaId, personaName,
//         requestId, updatedAt, lastReportAt } | null }] }. The hire is a projection of
//         the hired_agents row - never its report token.
// POST { arena, niche, taxonomyFamily?, budgetUsdPerAttempt? } -> gigs/specialist.ts
//         hireGigSpecialist: recipes resolved, spec composed, and the hire minted and
//         dispatched through the SHARED hire tail (mintAndDispatch - its own per-IP
//         limiter and failure reporting apply). A live specialist for the same arena +
//         niche is REUSED (200 `reused: true`); a new hire is 201. A failed hire answers
//         the hire tail's own status and code.
//
// Throttled per IP BEFORE the body is read, like the agents dispatch door: a hire mints
// a persona in Personas.

type HireProjection = Pick<HiredAgentRecord, "id" | "status" | "personaId" | "personaName" | "requestId" | "updatedAt" | "lastReportAt">;

function hireOf(agent: HiredAgentRecord | null): HireProjection | null {
  if (!agent) return null;
  return {
    id: agent.id,
    status: agent.status,
    personaId: agent.personaId,
    personaName: agent.personaName,
    requestId: agent.requestId,
    updatedAt: agent.updatedAt,
    lastReportAt: agent.lastReportAt,
  };
}

export async function GET(): Promise<NextResponse> {
  const denied = await requireOperator();
  if (denied) return denied;
  try {
    const ws = await currentWorkspace();
    const specialists = listGigSpecialists(ws).map((s) => ({ ...s, hire: hireOf(getHiredAgent(s.hiredAgentId, ws)) }));
    return NextResponse.json({ specialists });
  } catch (error) {
    return safeJsonError(error, "api:gigs/specialists", "GIG_STORE_FAILED");
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const denied = await requireOperator();
  if (denied) return denied;
  const under = await requireCapabilityCoded("pipeline:write", requireCapability);
  if (under) return under;
  if (!rateLimit(`gigs-specialist-hire:${clientIpFrom(request.headers)}`, { limit: 10, windowMs: 10 * 60_000 })) {
    return jsonRefusal("TOO_MANY_REQUESTS", 429);
  }
  try {
    const body = (await request.json().catch(() => ({}))) as {
      arena?: unknown;
      niche?: unknown;
      taxonomyFamily?: unknown;
      budgetUsdPerAttempt?: unknown;
    };
    if (!isGigArena(body.arena)) return jsonRefusal("GIG_INPUT_INVALID", 400, { field: "arena" });
    if (typeof body.niche !== "string" || !body.niche.trim()) return jsonRefusal("GIG_INPUT_INVALID", 400, { field: "niche" });
    if (body.taxonomyFamily !== undefined && body.taxonomyFamily !== null && typeof body.taxonomyFamily !== "string") {
      return jsonRefusal("GIG_INPUT_INVALID", 400, { field: "taxonomyFamily" });
    }
    if (body.budgetUsdPerAttempt !== undefined && body.budgetUsdPerAttempt !== null && typeof body.budgetUsdPerAttempt !== "number") {
      return jsonRefusal("GIG_INPUT_INVALID", 400, { field: "budgetUsdPerAttempt" });
    }
    const ws = await currentWorkspace();
    const res = await hireGigSpecialist(
      ws,
      {
        arena: body.arena,
        niche: body.niche,
        taxonomyFamily: typeof body.taxonomyFamily === "string" ? body.taxonomyFamily : null,
        budgetUsdPerAttempt: typeof body.budgetUsdPerAttempt === "number" ? body.budgetUsdPerAttempt : null,
      },
      request
    );
    if (!res.ok) {
      // The shared hire tail's own envelope: its code is registered where it is minted,
      // and its message was built for the client there (never a thrown error's text).
      return NextResponse.json({ error: res.error, code: res.code, hiredAgentId: res.hiredAgentId }, { status: res.status });
    }
    return NextResponse.json(
      {
        specialist: { ...res.specialist, hire: hireOf(getHiredAgent(res.hiredAgentId, ws)) },
        requestId: res.requestId,
        reused: res.reused,
        // Where the hire was filed in Personas (its arena's workspace), or why it was not.
        placement: res.placement,
        placementSkipped: res.placementSkipped,
      },
      { status: res.reused ? 200 : 201 }
    );
  } catch (error) {
    return safeJsonError(error, "api:gigs/specialists", "GIG_STORE_FAILED");
  }
}
