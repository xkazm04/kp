import { NextResponse } from "next/server";
import { jsonRefusal, safeJsonError, requireCapabilityCoded } from "@/app/_lib/api-response";
import { currentSession } from "@/app/_lib/auth/current-user";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { requireCapability } from "@/app/_lib/auth/current-user";
import { currentUserId } from "@/app/_lib/auth/session";
import { cvListItem, isActiveCv, listJobseekerCvs, makeJobseekerCvActive, recordJobseekerCv } from "@/app/_lib/db/jobseeker-cvs";
import { getJobseekerProfile } from "@/app/_lib/db/jobseeker-profiles";
import type { CvDraftSource, JobseekerCvListItem } from "@/app/_lib/jobseeker/types";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";
import type { ProfilePayload } from "@/app/features/shared/profileTypes";

// The seeker's CVs already read (docs/features/jobseeker/README.md, "Profile and CV
// studio"): GET lists them (metadata only — never the text, never the draft), POST
// records the CV an import just read and makes it the active one.
//
// POST is the import's LAST hop (StepArrive: extract-text → profile/draft → here). It
// takes the extracted text, the draft the model or the fixed parser produced and which
// of the two it was, stores them under the text's content hash (the same CV read again
// updates its row, never a twin), and writes the profile through makeJobseekerCvActive
// — the one path a reuse and "Use this one" take too.
//
// Posture: operator-gated by the fail-closed proxy and re-verified here. The seeker is
// the session's user (null in open mode), never a body field: nobody names whose CVs
// they read or write. The POST is a write behind a seat (pipeline:write).

const LIST_RATE_LIMIT = { limit: 120, windowMs: 10 * 60_000 };
const RECORD_RATE_LIMIT = { limit: 60, windowMs: 10 * 60_000 };
const MAX_FILE_NAME_CHARS = 255;

async function seeker(): Promise<{ userId: string | null; ws: string }> {
  const [session, ws] = await Promise.all([currentSession(), currentWorkspace()]);
  return { userId: currentUserId(session), ws };
}

// THROTTLE (rate-limit-contract.test.ts): a read of a short list, once per /me load and
// after each import; 120/10min per IP.
export async function GET(request: Request): Promise<NextResponse> {
  const denied = await requireOperator();
  if (denied) return denied;
  if (!rateLimit(`jobseeker-cvs-list:${clientIpFrom(request.headers)}`, LIST_RATE_LIMIT)) {
    return jsonRefusal("TOO_MANY_REQUESTS", 429);
  }
  try {
    const { userId, ws } = await seeker();
    const profile = getJobseekerProfile(userId, ws);
    const cvs: JobseekerCvListItem[] = listJobseekerCvs(userId, ws).map((cv) => cvListItem(cv, isActiveCv(cv, profile)));
    return NextResponse.json({ cvs });
  } catch (err) {
    return safeJsonError(err, "api:jobseeker/cvs", "JOBSEEKER_STORE_FAILED");
  }
}

function draftSourceOf(v: unknown): CvDraftSource | null {
  return v === "llm" || v === "deterministic" ? v : null;
}

// THROTTLE (rate-limit-contract.test.ts): two store writes per imported CV; the import
// writes once per file, so 60/10min per IP is the profile PUT's own budget.
export async function POST(request: Request): Promise<NextResponse> {
  const denied = await requireOperator();
  if (denied) return denied;
  const under = await requireCapabilityCoded("pipeline:write", requireCapability);
  if (under) return under;
  if (!rateLimit(`jobseeker-cvs-record:${clientIpFrom(request.headers)}`, RECORD_RATE_LIMIT)) {
    return jsonRefusal("TOO_MANY_REQUESTS", 429);
  }
  try {
    const body = (await request.json().catch(() => ({}))) as {
      text?: unknown;
      profile?: unknown;
      draftSource?: unknown;
      fileName?: unknown;
      byteSize?: unknown;
    };
    if (typeof body.text !== "string" || !body.text.trim()) return jsonRefusal("INTAKE_TEXT_REQUIRED", 400);
    if (!body.profile || typeof body.profile !== "object" || Array.isArray(body.profile)) return jsonRefusal("JOBSEEKER_REQUEST_INVALID", 400);
    const fileName = typeof body.fileName === "string" && body.fileName.trim() ? body.fileName.trim().slice(0, MAX_FILE_NAME_CHARS) : null;
    const byteSize = typeof body.byteSize === "number" && Number.isInteger(body.byteSize) && body.byteSize >= 0 ? body.byteSize : null;
    const { userId, ws } = await seeker();
    const cv = recordJobseekerCv(
      { userId, sourceText: body.text, draft: body.profile as ProfilePayload, draftSource: draftSourceOf(body.draftSource), fileName, byteSize },
      ws
    );
    const made = makeJobseekerCvActive(cv, userId, ws);
    return NextResponse.json({ profile: made.profile, cv: cvListItem(made.cv, true) });
  } catch (err) {
    return safeJsonError(err, "api:jobseeker/cvs", "JOBSEEKER_STORE_FAILED");
  }
}
