import { NextResponse } from "next/server";
import { jsonRefusal, safeJsonError } from "@/app/_lib/api-response";
import { currentSession } from "@/app/_lib/auth/current-user";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { currentUserId } from "@/app/_lib/auth/session";
import { getJobseekerProfile } from "@/app/_lib/db/jobseeker-profiles";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";

// GET /api/jobseeker/cv.md — the polished CV as a Markdown download. The seeker's
// own document, so it is the ONE jobseeker route whose body is not JSON; a 404 with
// a code when the studio has not produced one yet.
//
// THROTTLE (rate-limit-contract.test.ts): a read, but a read that streams a whole
// document per hit on a gate that is a no-op in open mode — 60/10min per IP.
const EXPORT_RATE_LIMIT = { limit: 60, windowMs: 10 * 60_000 };

export async function GET(request: Request): Promise<NextResponse> {
  const denied = await requireOperator();
  if (denied) return denied;
  if (!rateLimit(`jobseeker-cv-export:${clientIpFrom(request.headers)}`, EXPORT_RATE_LIMIT)) {
    return jsonRefusal("TOO_MANY_REQUESTS", 429);
  }
  try {
    const [session, ws] = await Promise.all([currentSession(), currentWorkspace()]);
    const profile = getJobseekerProfile(currentUserId(session), ws);
    if (!profile?.cvPolishedMd) return jsonRefusal("JOBSEEKER_PROFILE_MISSING", 404);
    return new NextResponse(profile.cvPolishedMd, {
      status: 200,
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": 'attachment; filename="cv.md"',
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return safeJsonError(err, "api:jobseeker/cv.md", "JOBSEEKER_STORE_FAILED");
  }
}
