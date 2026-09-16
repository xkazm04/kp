import { NextResponse } from "next/server";
import { jsonRefusal } from "@/app/_lib/api-response";
import { requireOperator } from "@/app/_lib/auth/require-operator";

// GET /api/jobseeker/profile — the seeker's own profile (WP2 fills in the store read
// and the PUT). WP0 pre-seed: the route exists so the api-reference generator, the
// auth-posture check and the doc-sync map all see the surface from the first commit.
// Posture: operator-gated by the fail-closed proxy (not in PUBLIC_API_*), and
// re-verified here (defense in depth, like every route that reads a person's data).
export async function GET(): Promise<NextResponse> {
  const denied = await requireOperator();
  if (denied) return denied;
  return jsonRefusal("JOBSEEKER_PROFILE_MISSING", 404);
}
