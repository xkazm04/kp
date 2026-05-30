import { NextRequest, NextResponse } from "next/server";
import { getGroupEval, listEvaluatedRoles } from "@/app/_lib/group-eval";

export const runtime = "nodejs";

// Read saved group evaluations. The evaluation is GENERATED via the background
// task system (kind "group_eval" → runGroupEval saves here); this route only
// reads, so the Decisions modal can show a stored eval without re-running.
//   GET ?role=<key>        → the saved evaluation for one role (or null)
//   GET ?roles=a,b,c       → { evaluated: { <key>: createdAt } } for the given roles
export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const role = sp.get("role");
    if (role) {
      return NextResponse.json({ evaluation: getGroupEval(role) });
    }
    const roles = (sp.get("roles") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    return NextResponse.json({ evaluated: listEvaluatedRoles(roles) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed." }, { status: 500 });
  }
}
