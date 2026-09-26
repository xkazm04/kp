import { NextResponse } from "next/server";
import { jsonRefusal, safeJsonError, requireCapabilityCoded } from "@/app/_lib/api-response";
import { currentSession } from "@/app/_lib/auth/current-user";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { requireCapability } from "@/app/_lib/auth/current-user";
import { currentUserId } from "@/app/_lib/auth/session";
import { cvListItem, getJobseekerCv, makeJobseekerCvActive } from "@/app/_lib/db/jobseeker-cvs";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";

// "Use this one" on an earlier CV (docs/features/jobseeker/README.md, "Profile and CV
// studio"): the stored draft, text and hash become the profile's through
// makeJobseekerCvActive — exactly what an import writes — and no model is asked.
//
// The id resolves only inside THIS seeker's CVs (workspace AND user): another seeker's
// id, or another workspace's, is 404 JOBSEEKER_CV_NOT_FOUND, never their CV.

const USE_RATE_LIMIT = { limit: 60, windowMs: 10 * 60_000 };

// THROTTLE (rate-limit-contract.test.ts): one profile write per pick; 60/10min per IP.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const denied = await requireOperator();
  if (denied) return denied;
  const under = await requireCapabilityCoded("pipeline:write", requireCapability);
  if (under) return under;
  if (!rateLimit(`jobseeker-cvs-use:${clientIpFrom(request.headers)}`, USE_RATE_LIMIT)) {
    return jsonRefusal("TOO_MANY_REQUESTS", 429);
  }
  try {
    const { id } = await params;
    const [session, ws] = await Promise.all([currentSession(), currentWorkspace()]);
    const userId = currentUserId(session);
    const cv = getJobseekerCv(id, userId, ws);
    if (!cv) return jsonRefusal("JOBSEEKER_CV_NOT_FOUND", 404);
    const made = makeJobseekerCvActive(cv, userId, ws);
    return NextResponse.json({ profile: made.profile, cv: cvListItem(made.cv, true) });
  } catch (err) {
    return safeJsonError(err, "api:jobseeker/cvs/use", "JOBSEEKER_STORE_FAILED");
  }
}
