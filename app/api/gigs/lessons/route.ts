import { NextResponse } from "next/server";
import { jsonRefusal, safeJsonError, requireCapabilityCoded } from "@/app/_lib/api-response";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { requireCapability } from "@/app/_lib/auth/current-user";
import { listPendingGigLessons, markGigLessonsLanded } from "@/app/_lib/db/gigs-outcomes";
import { gigRecipeIndexPaths } from "@/app/_lib/gigs/recipes";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";
import { AUTOMATION_TOKEN_HEADER, checkAutomationToken, resolveHireWorkspace } from "../../agents/hire-from-need/automation-auth";

// /api/gigs/lessons - the export queue the registry lander drains.
// GET  [?pending=1][&workspace=] -> { lessons: [{ id, outcomeId, recipe: { slug, version },
//        recipePath, arena, verdict, bullets, createdAt }] } - the lessons not yet landed,
//        oldest first. `recipePath` is the recipe's folder RELATIVE to the registry
//        checkout, as the registry's recipes/index.json lists it (where LESSONS.md goes);
//        null when the index does not carry the slug (the three seed-only arena recipes
//        today) or no registry checkout is present on this machine.
// POST { ids: string[], workspace? } -> { landed: n } - stamps `landed_at` on the given
//        still-pending lessons (the lander calls it AFTER committing them). A lesson
//        already landed keeps its first date.
//
// TWO DOORS, a caller needs one - the machine door of POST /api/agents/hire-from-need,
// REUSED (its automation-auth.ts, not a copy): the `x-kp-automation-token` header
// matching KP_AUTOMATION_TOKEN (unset = that door closed; the operator door still
// works), or the operator session (+ pipeline:write on the POST). A machine caller may
// name the workspace; a human is held to the session's own.

const MAX_IDS = 500;

type Door = { ok: true; machine: boolean } | { ok: false; response: NextResponse };

async function door(request: Request, write: boolean): Promise<Door> {
  if (checkAutomationToken(request.headers.get(AUTOMATION_TOKEN_HEADER)).outcome === "accepted") return { ok: true, machine: true };
  const denied = await requireOperator();
  if (denied) return { ok: false, response: denied };
  if (write) {
    const under = await requireCapabilityCoded("pipeline:write", requireCapability);
    if (under) return { ok: false, response: under };
  }
  return { ok: true, machine: false };
}

async function workspaceFor(machine: boolean, named: unknown): Promise<string | null> {
  const tenant = resolveHireWorkspace({
    machine,
    bodyWorkspace: typeof named === "string" ? named : "",
    sessionWorkspace: await currentWorkspace(),
  });
  return tenant.ok ? tenant.workspace : null;
}

export async function GET(request: Request): Promise<NextResponse> {
  const d = await door(request, false);
  if (!d.ok) return d.response;
  try {
    const q = new URL(request.url).searchParams;
    const pending = q.get("pending");
    // Only the pending queue is served: the landed history lives in the registry.
    if (pending !== null && pending !== "1" && pending !== "true") return jsonRefusal("GIG_INPUT_INVALID", 400, { field: "pending" });
    const ws = await workspaceFor(d.machine, q.get("workspace"));
    if (!ws) return jsonRefusal("FORBIDDEN_CAPABILITY", 403);
    const lessons = listPendingGigLessons(ws);
    const paths = gigRecipeIndexPaths([...new Set(lessons.map((l) => l.recipe.slug))]);
    return NextResponse.json({
      lessons: lessons.map((l) => ({
        id: l.id,
        outcomeId: l.outcomeId,
        recipe: l.recipe,
        recipePath: paths[l.recipe.slug] ?? null,
        arena: l.arena,
        verdict: l.verdict,
        bullets: l.bullets,
        createdAt: l.createdAt,
      })),
    });
  } catch (error) {
    return safeJsonError(error, "api:gigs/lessons", "GIG_STORE_FAILED");
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const d = await door(request, true);
  if (!d.ok) return d.response;
  if (!rateLimit(`gigs-lessons-land:${clientIpFrom(request.headers)}`, { limit: 60, windowMs: 10 * 60_000 })) {
    return jsonRefusal("TOO_MANY_REQUESTS", 429);
  }
  try {
    const body = (await request.json().catch(() => ({}))) as { ids?: unknown; workspace?: unknown };
    if (!Array.isArray(body.ids) || body.ids.length === 0 || body.ids.length > MAX_IDS || !body.ids.every((v) => typeof v === "string" && v.length > 0 && v.length <= 100)) {
      return jsonRefusal("GIG_INPUT_INVALID", 400, { field: "ids", maxIds: MAX_IDS });
    }
    const ws = await workspaceFor(d.machine, body.workspace);
    if (!ws) return jsonRefusal("FORBIDDEN_CAPABILITY", 403);
    return NextResponse.json({ landed: markGigLessonsLanded(ws, body.ids as string[]) });
  } catch (error) {
    return safeJsonError(error, "api:gigs/lessons", "GIG_STORE_FAILED");
  }
}
