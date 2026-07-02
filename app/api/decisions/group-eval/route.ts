import { NextRequest, NextResponse } from "next/server";
import { getGroupEval, listEvaluatedRoles } from "@/app/_lib/group-eval";
import { requireOperator } from "@/app/_lib/auth/require-operator";

export const runtime = "nodejs";

// Read saved group evaluations. The evaluation is GENERATED via the background
// task system (kind "group_eval" → runGroupEval saves here); this route only
// reads, so the Decisions modal can show a stored eval without re-running.
//   GET ?role=<key>        → the saved evaluation for one role (or null)
//   GET ?roles=a,b,c       → { evaluated: { <key>: createdAt } } for the given roles
// Operator-gated (backlog #30 / SD-L1-010): a stored eval names and ranks real
// candidates with comp expectations, so the handler re-verifies the session
// (and rejects the anonymous demo session) like the rest of /api/decisions/*.
export async function GET(request: NextRequest) {
  const denied = await requireOperator();
  if (denied) return denied;
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
