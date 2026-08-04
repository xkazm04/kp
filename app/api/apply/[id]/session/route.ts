import { NextRequest, NextResponse } from "next/server";
import { getJob, getJobWorkspace } from "@/app/_lib/db";
import { getJobStatus, isJobOpenForApplications } from "@/app/_lib/job-ingest";
import { startApplySession, type ApplySessionFlow } from "@/app/_lib/apply-session-store";
import { clientIpFrom, rateLimit, RATE_LIMITED_ERROR } from "@/app/_lib/rate-limit";
import { safeJsonError } from "@/app/_lib/api-response";

// Records that a candidate OPENED an application, which is the apply funnel's
// missing denominator (see apply-session-store.ts). Called once by the client on
// first render of either intake surface, with an id the client keeps in
// localStorage so a reload re-sends the same one instead of counting twice.
//
// Same trust boundary as the submit routes — public, unauthenticated,
// side-effecting — so it is rate-limited and refuses closed/draft roles. It writes
// exactly one row and returns no candidate data.
const SESSION_RATE_LIMIT = { limit: 12, windowMs: 60_000 };

// A client-supplied id is untrusted input used as a primary key: bound the length
// and the alphabet so it cannot carry a payload or bloat the row.
const SESSION_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

function coerceFlow(raw: unknown): ApplySessionFlow | null {
  return raw === "chat" || raw === "quick" ? raw : null;
}

function coerceTag(raw: unknown): string | null {
  return typeof raw === "string" && raw.trim() ? raw.trim().slice(0, 64) : null;
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    if (!rateLimit(`apply-session:${id}:${clientIpFrom(request.headers)}`, SESSION_RATE_LIMIT)) {
      return NextResponse.json({ error: RATE_LIMITED_ERROR }, { status: 429 });
    }
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const sessionId = typeof body?.sessionId === "string" ? body.sessionId : "";
    const flow = coerceFlow(body?.flow);
    if (!SESSION_ID_RE.test(sessionId) || !flow) {
      return NextResponse.json({ error: "Invalid session." }, { status: 400 });
    }
    if (!getJob(id)) return NextResponse.json({ error: "Role not found." }, { status: 404 });
    // Don't count starts against a role that cannot be applied to — the submit
    // routes refuse those, so counting them would create guaranteed abandonment.
    if (!isJobOpenForApplications(getJobStatus(id))) {
      return NextResponse.json({ error: "Role closed." }, { status: 410 });
    }
    startApplySession({
      id: sessionId,
      jobId: id,
      flow,
      campaign: coerceTag(body?.campaign),
      variant: coerceTag(body?.variant),
      workspaceId: getJobWorkspace(id),
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return safeJsonError(error, "api:apply:session", "APPLY_FAILED");
  }
}
