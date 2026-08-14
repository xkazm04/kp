import { NextRequest, NextResponse } from "next/server";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { createArchetype, listArchetypes } from "@/app/_lib/archetype-registry";


// Live archetype registry for the Profile management UI (reads the shared JSON
// fresh, so an edit is reflected immediately regardless of the static import).
//
// The READ stays open — the same split as /api/brand. This is deployment-level
// config (labels, badges, weights) with no candidate or workspace data in it, and
// the profile pickers render their routing segments straight from it; gating it
// would blank those segments for no security gain. The WRITE below is gated.
export async function GET() {
  try {
    return NextResponse.json({ archetypes: await listArchetypes() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to read archetypes.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// Operator-gated write. The registry is ONE file per deployment
// (pipeline/jobfit/archetypes.json — the same file the Python scorer re-reads on
// every spawn), so global storage is correct here and per-workspace scoping would
// be the wrong fix. What was missing is the gate: ungated, any signed-in user of
// any workspace could add an archetype whose detection/weights then re-route and
// re-score candidates for EVERY tenant on the deployment. requireOperator is
// deliberately coarse (open mode stays open for local dev, and it rejects the
// anonymous demo session); who inside an org may edit it is an RBAC question this
// route does not answer.
export async function POST(request: NextRequest) {
  const denied = await requireOperator();
  if (denied) return denied;
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
