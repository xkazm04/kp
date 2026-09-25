import { NextResponse } from "next/server";
import { jsonRefusal, safeJsonError, requireCapabilityCoded } from "@/app/_lib/api-response";
import { currentSession } from "@/app/_lib/auth/current-user";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { requireCapability } from "@/app/_lib/auth/current-user";
import { currentUserId } from "@/app/_lib/auth/session";
import { getJobseekerProfile, upsertJobseekerProfile } from "@/app/_lib/db/jobseeker-profiles";
import { mergePreferencePatch, parsePreferencesPatch } from "@/app/_lib/jobseeker/profile";
import { EMPTY_PREFERENCES } from "@/app/_lib/jobseeker/types";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";
import type { ProfilePayload } from "@/app/features/shared/profileTypes";

// The seeker's OWN profile (docs/features/jobseeker/README.md, "Profile and CV
// studio"). One row per (workspace, user): the CandidateProfileV2 the pipeline
// extracted from their CV, the preferences the studio elicited, the polished CV.
//
// Posture: operator-gated by the fail-closed proxy (not in PUBLIC_API_*), and
// re-verified here (defense in depth, like every route that reads a person's data).
// The user id comes from the session — null in open mode, where the workspace has
// one seeker — never from the body: a seeker cannot name whose row they edit.

const PROFILE_RATE_LIMIT = { limit: 60, windowMs: 10 * 60_000 };
const MAX_CV_SOURCE_CHARS = 200_000;

async function principal(): Promise<{ userId: string | null; ws: string }> {
  const [session, ws] = await Promise.all([currentSession(), currentWorkspace()]);
  return { userId: currentUserId(session), ws };
}

export async function GET(): Promise<NextResponse> {
  const denied = await requireOperator();
  if (denied) return denied;
  try {
    const { userId, ws } = await principal();
    const profile = getJobseekerProfile(userId, ws);
    if (!profile) return jsonRefusal("JOBSEEKER_PROFILE_MISSING", 404);
    return NextResponse.json(profile);
  } catch (err) {
    return safeJsonError(err, "api:jobseeker/profile", "JOBSEEKER_STORE_FAILED");
  }
}

// PUT — create or replace. `profile` is the profile_draft output (the recruiter-side
// shape, reused verbatim); `preferences` is a PARTIAL merged over what is stored;
// `cvSourceText` is `undefined` = keep, `null` = clear, a string = replace.
//
// `preferencesReplace: true` is the DIRECT-EDIT door (the /me flow's "What you want"
// cards): the fields the patch names replace the stored ones outright, so removing the
// last place really empties the list. Without it the merge keeps a stated list against
// an empty one — the right rule for a conversation turn that simply did not mention
// places, and the wrong one for a seeker who deleted them.
//
// THROTTLE (rate-limit-contract.test.ts): the route is a store write behind the
// operator gate, but in open mode the gate is a no-op, so it self-limits per IP at a
// budget no human meets (60/10min — the import flow writes once per CV).
export async function PUT(request: Request): Promise<NextResponse> {
  const denied = await requireOperator();
  if (denied) return denied;
  // The seeker's own data, but still a WRITE behind a seat: a viewer seat may read the
  // feed, not spend a scan, a model turn or a source acknowledgement (route-capability-coverage).
  const under = await requireCapabilityCoded("pipeline:write", requireCapability);
  if (under) return under;
  if (!rateLimit(`jobseeker-profile:${clientIpFrom(request.headers)}`, PROFILE_RATE_LIMIT)) {
    return jsonRefusal("TOO_MANY_REQUESTS", 429);
  }
  try {
    const body = (await request.json().catch(() => ({}))) as {
      profile?: unknown;
      preferences?: unknown;
      preferencesReplace?: unknown;
      cvSourceText?: unknown;
    };
    const { userId, ws } = await principal();
    const existing = getJobseekerProfile(userId, ws);
    const profile: ProfilePayload =
      body.profile && typeof body.profile === "object" ? (body.profile as ProfilePayload) : existing?.profile ?? ({} as ProfilePayload);
    const base = existing?.preferences ?? EMPTY_PREFERENCES;
    const patch = parsePreferencesPatch(body.preferences);
    const preferences = body.preferencesReplace === true ? { ...base, ...patch } : mergePreferencePatch(base, patch);
    const cvSourceText =
      body.cvSourceText === null ? null : typeof body.cvSourceText === "string" ? body.cvSourceText.slice(0, MAX_CV_SOURCE_CHARS) : undefined;
    const saved = upsertJobseekerProfile({ userId, profile, preferences, cvSourceText }, ws);
    return NextResponse.json(saved);
  } catch (err) {
    return safeJsonError(err, "api:jobseeker/profile", "JOBSEEKER_STORE_FAILED");
  }
}
