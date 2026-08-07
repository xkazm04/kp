import { NextRequest, NextResponse } from "next/server";
import { setArchetypeArchived, updateArchetype, type ArchetypeError } from "@/app/_lib/archetype-registry";

// Surface a structured registry error: `error` stays the English message (direct API
// callers), `code`/`params` let the client render a localized label. `not_found` → 404;
// everything else is a 400 (bad edit / protected archetype).
function errorResponse(err: ArchetypeError) {
  const status = err.code === "not_found" ? 404 : 400;
  return NextResponse.json({ error: err.message, code: err.code, params: err.params }, { status });
}

export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }) {
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
