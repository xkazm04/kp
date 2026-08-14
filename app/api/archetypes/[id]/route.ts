import { NextRequest, NextResponse } from "next/server";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { setArchetypeArchived, updateArchetype, type ArchetypeError } from "@/app/_lib/archetype-registry";

// Both handlers here WRITE the shared archetype registry
// (pipeline/jobfit/archetypes.json — one file per deployment, re-read by the Python
// scorer on every spawn), so both are operator-gated, matching POST /api/archetypes
// and the write half of /api/brand. Global storage is right; the missing piece was
// the gate. Ungated, any signed-in user of any workspace could reweight an archetype,
// rename one out from under another team's pickers, retire the one a live pipeline
// routes to — or untick `fairnessProtected` on "student" and hand the auto-reject
// wave a cohort every other tenant had protected. requireOperator is deliberately
// coarse (open mode stays open for local dev, and it rejects the anonymous demo
// session); per-role permissions are a separate product decision.

// Surface a structured registry error: `error` stays the English message (direct API
// callers), `code`/`params` let the client render a localized label. `not_found` → 404;
// everything else is a 400 (bad edit / protected archetype).
function errorResponse(err: ArchetypeError) {
  const status = err.code === "not_found" ? 404 : 400;
  return NextResponse.json({ error: err.message, code: err.code, params: err.params }, { status });
}

export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const denied = await requireOperator();
  if (denied) return denied;
  try {
    const { id } = await context.params;
    const body = (await request.json()) as Record<string, unknown>;
    const result = await updateArchetype(id, body);
    if ("error" in result) return errorResponse(result.error);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update archetype.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// Retire / restore a custom archetype (archived lifecycle). Body: { archived: boolean }.
// Built-in archetypes are refused (archive_builtin) with an honest reason.
export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const denied = await requireOperator();
  if (denied) return denied;
  try {
    const { id } = await context.params;
    const body = (await request.json()) as { archived?: unknown };
    if (typeof body.archived !== "boolean") {
      return NextResponse.json({ error: "archived must be a boolean.", code: "archived_invalid" }, { status: 400 });
    }
    const result = await setArchetypeArchived(id, body.archived);
    if ("error" in result) return errorResponse(result.error);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update archetype.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
