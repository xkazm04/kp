import { NextResponse } from "next/server";
import { jsonRefusal, safeJsonError, requireCapabilityCoded } from "@/app/_lib/api-response";
import { currentSession } from "@/app/_lib/auth/current-user";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { requireCapability } from "@/app/_lib/auth/current-user";
import { currentUserId } from "@/app/_lib/auth/session";
import { getJobseekerPosting } from "@/app/_lib/db/jobseeker-postings";
import { getJobseekerProfile } from "@/app/_lib/db/jobseeker-profiles";
import { getCoverNote, getCvDesignState, setCoverNote, setCvDesignState } from "@/app/_lib/db/jobseeker-ui-state";
import { COVER_NOTE_MAX_CHARS } from "@/app/_lib/jobseeker/types";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";
import { parseCvDesign, type CvDesign } from "@/app/features/jobseeker/cv/cvQuery";

// The seeker's UI state that follows them across browsers (docs/features/jobseeker/
// README.md): the designed-CV choices (template, accent, tailor, compact, objective) and
// a cover-note draft per posting. The browser keeps its own copy only as an instant first
// paint; this is the record.
//
//   GET ?posting=<id>  → { design, designAt, cover }   (cover only when a posting is named)
//   PUT { design }                → the choices, re-validated through cvQuery.ts
//   PUT { posting, cover }        → one note, at most COVER_NOTE_MAX_CHARS
//
// Both halves hang off the session's OWN profile row (workspace + user), so a body can
// never name whose state it writes; a posting must be one this workspace holds. The
// design stays URL-shaped (cvQuery.ts): the print page and the PDF route keep reading
// their query parameters, this only remembers the last choice.

const READ_RATE_LIMIT = { limit: 240, windowMs: 10 * 60_000 };
const WRITE_RATE_LIMIT = { limit: 600, windowMs: 10 * 60_000 };

async function seekerProfileId(): Promise<{ profileId: string | null; ws: string }> {
  const [session, ws] = await Promise.all([currentSession(), currentWorkspace()]);
  return { profileId: getJobseekerProfile(currentUserId(session), ws)?.id ?? null, ws };
}

/** A stored or posted design, through the ONE validator the print page and PDF use. */
function designOf(raw: unknown): CvDesign | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  return parseCvDesign((key) => {
    const v = r[key];
    if (typeof v === "string") return v;
    if (typeof v === "number" && Number.isInteger(v)) return String(v);
    if (typeof v === "boolean") return v ? "1" : "0";
    return null;
  });
}

// THROTTLE (rate-limit-contract.test.ts): one read per posting opened on the Weigh step
// and one per designer mount — the posting read's own rhythm; 240/10min per IP.
export async function GET(request: Request): Promise<NextResponse> {
  const denied = await requireOperator();
  if (denied) return denied;
  if (!rateLimit(`jobseeker-ui-state-read:${clientIpFrom(request.headers)}`, READ_RATE_LIMIT)) {
    return jsonRefusal("TOO_MANY_REQUESTS", 429);
  }
  try {
    const { profileId, ws } = await seekerProfileId();
    if (!profileId) return jsonRefusal("JOBSEEKER_PROFILE_MISSING", 404);
    const posting = new URL(request.url).searchParams.get("posting");
    const design = getCvDesignState(profileId, ws);
    const cover = posting ? getCoverNote(profileId, posting, ws) : null;
    return NextResponse.json({
      design: design ? designOf(design.value) : null,
      designAt: design?.updatedAt ?? null,
      cover: cover ? { text: cover.value, updatedAt: cover.updatedAt } : null,
    });
  } catch (err) {
    return safeJsonError(err, "api:jobseeker/ui-state", "JOBSEEKER_STORE_FAILED");
  }
}

// THROTTLE (rate-limit-contract.test.ts): the client writes debounced (one save per pause
// in typing or per design pick), so a seeker drafting a long note for ten minutes stays
// far below 600/10min per IP.
export async function PUT(request: Request): Promise<NextResponse> {
  const denied = await requireOperator();
  if (denied) return denied;
  const under = await requireCapabilityCoded("pipeline:write", requireCapability);
  if (under) return under;
  if (!rateLimit(`jobseeker-ui-state-write:${clientIpFrom(request.headers)}`, WRITE_RATE_LIMIT)) {
    return jsonRefusal("TOO_MANY_REQUESTS", 429);
  }
  try {
    const body = (await request.json().catch(() => null)) as { design?: unknown; posting?: unknown; cover?: unknown } | null;
    if (!body || typeof body !== "object") return jsonRefusal("JOBSEEKER_REQUEST_INVALID", 400);
    const { profileId, ws } = await seekerProfileId();
    if (!profileId) return jsonRefusal("JOBSEEKER_PROFILE_MISSING", 404);

    if (body.posting !== undefined || body.cover !== undefined) {
      if (typeof body.posting !== "string" || !body.posting || typeof body.cover !== "string" || body.cover.length > COVER_NOTE_MAX_CHARS) {
        return jsonRefusal("JOBSEEKER_REQUEST_INVALID", 400);
      }
      if (!getJobseekerPosting(body.posting, ws)) return jsonRefusal("POSTING_NOT_FOUND", 404);
      const updatedAt = setCoverNote(profileId, body.posting, body.cover, ws);
      return NextResponse.json({ ok: true, updatedAt });
    }

    const design = designOf(body.design);
    if (!design) return jsonRefusal("JOBSEEKER_REQUEST_INVALID", 400);
    const updatedAt = setCvDesignState(profileId, design, ws);
    return NextResponse.json({ ok: true, design, updatedAt });
  } catch (err) {
    return safeJsonError(err, "api:jobseeker/ui-state", "JOBSEEKER_STORE_FAILED");
  }
}
