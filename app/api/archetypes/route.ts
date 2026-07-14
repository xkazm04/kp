import { NextRequest, NextResponse } from "next/server";
import { createArchetype, listArchetypes } from "@/app/_lib/archetype-registry";


// Live archetype registry for the Profile management UI (reads the shared JSON
// fresh, so an edit is reflected immediately regardless of the static import).
export async function GET() {
  try {
    return NextResponse.json({ archetypes: await listArchetypes() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to read archetypes.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const result = await createArchetype(body);
    // `error` is the English message (direct API callers); `code`/`params` let the
    // client localize. All create errors are client-fixable input ⇒ 400.
    if ("error" in result) {
      return NextResponse.json({ error: result.error.message, code: result.error.code, params: result.error.params }, { status: 400 });
    }
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create archetype.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
