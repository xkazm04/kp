import { NextResponse } from "next/server";
import { listScheduleInvites, setScheduleInviteMeetingUrl } from "@/app/_lib/schedule-store";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { safeJsonError } from "@/app/_lib/api-response";
import { clientIpFrom, rateLimit, RATE_LIMITED_ERROR } from "@/app/_lib/rate-limit";


// W6-3 (SCH1) — the recruiter's read over the invite lifecycle. The store
// deliberately persists operator flags ("recruiter must open more times",
// "booked but the pipeline didn't advance") that previously terminated in a
// server console; this serves them to the Schedule tab's lifecycle panel
// along with the booked agenda and un-booked invites.
export async function GET() {
  try {
    return NextResponse.json({ invites: listScheduleInvites(200, await currentWorkspace()) });
  } catch (error) {
    return safeJsonError(error, "api:schedule", "SCHEDULE_LOOKUP_FAILED");
  }
}

// http/https only — a meeting link is rendered as an <a> and baked into a calendar
// event, so reject javascript:/data: and anything unparseable. Empty ⇒ clear (null).
function normalizeMeetingUrl(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const u = new URL(raw.trim());
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

// PATCH → recruiter attaches (or clears) an interview join link on an invite. Same
// no-auth-layer posture as POST /api/schedule/invite (rate-limited per IP); the
// candidate never reaches this route (they use the token route).
export async function PATCH(request: Request) {
  try {
    if (!rateLimit(`sched-meet:${clientIpFrom(request.headers)}`, { limit: 60, windowMs: 60_000 })) {
      return NextResponse.json({ error: RATE_LIMITED_ERROR }, { status: 429 });
    }
    const body = (await request.json().catch(() => ({}))) as { token?: string; meetingUrl?: string | null };
    if (!body.token) return NextResponse.json({ error: "token is required" }, { status: 400 });
    const raw = typeof body.meetingUrl === "string" ? body.meetingUrl.trim() : "";
    let url: string | null = null;
    if (raw) {
      url = normalizeMeetingUrl(raw);
      if (!url) return NextResponse.json({ error: "Enter a valid http(s) meeting link." }, { status: 400 });
    }
    const updated = setScheduleInviteMeetingUrl(body.token, url);
    if (!updated) return NextResponse.json({ error: "invite not found" }, { status: 404 });
    return NextResponse.json({ invite: updated });
  } catch (error) {
    return safeJsonError(error, "api:schedule", "SCHEDULE_LOOKUP_FAILED");
  }
}
