import { NextResponse } from "next/server";
import { jsonRefusal, safeJsonError, requireCapabilityCoded } from "@/app/_lib/api-response";
import { currentSession } from "@/app/_lib/auth/current-user";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { requireCapability } from "@/app/_lib/auth/current-user";
import { currentUserId } from "@/app/_lib/auth/session";
import { cvListItem, findJobseekerCvByText, makeJobseekerCvActive } from "@/app/_lib/db/jobseeker-cvs";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";

// "Have I read this CV before?" — asked by the import between extract-text and the
// draft (docs/features/jobseeker/README.md, "Profile and CV studio"). The text a file
// extracted to is hashed (whitespace-normalised); when THIS seeker has a stored CV with
// that hash, its stored draft is applied through makeJobseekerCvActive — the path an
// import and "Use this one" take — and the answer says so, with the date it was first
// read, so the page can say "read before, reused, no AI call". Otherwise nothing is
// written and the import goes on to draft it.
//
// This door never drafts: it has no path to the model or the Python engine (the reuse
// route test pins that its source imports neither). "Read it again" is the client
// skipping this door, not a flag on it.
//
// Posture: operator-gated and a seat write (pipeline:write) because a hit writes the
// profile. The seeker is the session's user, never a body field.

const REUSE_RATE_LIMIT = { limit: 60, windowMs: 10 * 60_000 };

// THROTTLE (rate-limit-contract.test.ts): one hash + one lookup per dropped CV, the
// import's own rhythm; 60/10min per IP, the profile PUT's budget.
export async function POST(request: Request): Promise<NextResponse> {
  const denied = await requireOperator();
  if (denied) return denied;
  const under = await requireCapabilityCoded("pipeline:write", requireCapability);
  if (under) return under;
  if (!rateLimit(`jobseeker-cvs-reuse:${clientIpFrom(request.headers)}`, REUSE_RATE_LIMIT)) {
    return jsonRefusal("TOO_MANY_REQUESTS", 429);
  }
  try {
    const body = (await request.json().catch(() => ({}))) as { text?: unknown };
    if (typeof body.text !== "string" || !body.text.trim()) return jsonRefusal("INTAKE_TEXT_REQUIRED", 400);
    const [session, ws] = await Promise.all([currentSession(), currentWorkspace()]);
    const userId = currentUserId(session);
    const stored = findJobseekerCvByText(userId, body.text, ws);
    if (!stored) return NextResponse.json({ reused: false });
    const made = makeJobseekerCvActive(stored, userId, ws);
    return NextResponse.json({ reused: true, profile: made.profile, cv: cvListItem(made.cv, true) });
  } catch (err) {
    return safeJsonError(err, "api:jobseeker/cvs/reuse", "JOBSEEKER_STORE_FAILED");
  }
}
