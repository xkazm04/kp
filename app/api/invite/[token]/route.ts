import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, SESSION_TTL_MS, signSession } from "@/app/_lib/auth/session";
import { getRedeemableInvite } from "@/app/_lib/db/invites";
import { getOrganization } from "@/app/_lib/db/organizations";
import { getUserByEmail } from "@/app/_lib/db/users";
import { acceptInvite, MIN_PASSWORD_LENGTH } from "@/app/_lib/org-service";
import { clientIpFrom, rateLimit, RATE_LIMITED_ERROR } from "@/app/_lib/rate-limit";

// PUBLIC (proxy allow-listed): the invited-member accept flow. GET previews a
// redeemable invite; POST redeems it (sets the password, adds the membership) and
// signs the new user straight in on their team.
//
// Abuse containment (2026-09-01): the sibling door into the same tenant,
// /api/auth/register, is throttled (10 per 15 min); this one was not, and it
// creates a user, a membership AND a session cookie — while its GET discloses an
// invitee's email and org name to any token holder. The token is a strong CSPRNG
// capability, so this is not guessing prevention: it caps what one link-holder (or
// a leaked link) can do per minute, keyed by token AND client like every sibling.
// 10/min covers a human retrying a weak password several times; a script that
// wants more is the point.
const INVITE_RATE_LIMIT = { limit: 10, windowMs: 60_000 };

export async function GET(request: NextRequest, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  if (!rateLimit(`invite-view:${clientIpFrom(request.headers)}:${token}`, INVITE_RATE_LIMIT)) {
    return NextResponse.json({ error: RATE_LIMITED_ERROR }, { status: 429 });
  }
  const invite = getRedeemableInvite(token);
  if (!invite) return NextResponse.json({ valid: false }, { status: 404 });
  const org = getOrganization(invite.orgId);
  const existing = getUserByEmail(invite.email);
  return NextResponse.json({
    valid: true,
    email: invite.email,
    role: invite.role,
    // The client renders a LOCALIZED fallback (invite.orgNameFallback) when this is
    // null. It used to be the English literal "your organization", spliced into a
    // four-locale eyebrow by the server, which had no idea who was reading.
    orgName: org?.name ?? null,
    needsName: !existing?.name, // a brand-new invitee supplies their name; a re-invite keeps it
    minPasswordLength: MIN_PASSWORD_LENGTH,
  });
}

export async function POST(request: NextRequest, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  // Throttle BEFORE the body is even read: the redeem path writes a user, a
  // membership and a session, so the flood must be refused at the door.
  if (!rateLimit(`invite-redeem:${clientIpFrom(request.headers)}:${token}`, INVITE_RATE_LIMIT)) {
    return NextResponse.json({ error: RATE_LIMITED_ERROR }, { status: 429 });
  }
  const body = (await request.json().catch(() => ({}))) as { name?: unknown; password?: unknown };
  const password = typeof body.password === "string" ? body.password : "";
  const name = typeof body.name === "string" ? body.name : null;

  const result = acceptInvite({ token, name, password });
  if (!result.ok) {
    const status =
      result.reason === "weak_password" ? 400 : result.reason === "email_taken" || result.reason === "already_active" ? 409 : 410;
    return NextResponse.json({ error: result.reason }, { status });
  }
  const res = NextResponse.json({ ok: true });
  // Best-effort auto-login: sign the new member in on their team. If session
  // signing is unavailable (KP_SECRET unset — open dev), the account is STILL
  // created; the client just lands on / (or /login) to sign in manually. Never let
  // a signing failure 500 after the invite is already consumed.
  try {
    // bug-ui-scan-2026-07-09 (organizations-members-invites #3): sign the session
    // for the team/role the invite just granted (result.workspaceId/role), not the
    // oldest membership from listMembershipsForUser(...)[0] — a re-invited member was
    // landing on their previous team with their previous role.
    const session = signSession(result.workspaceId, Date.now(), {
      sub: result.user.id,
      org: result.user.orgId,
      role: result.role,
    });
    res.cookies.set(SESSION_COOKIE, session, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: Math.floor(SESSION_TTL_MS / 1000),
    });
  } catch {
    /* KP_SECRET unavailable — skip auto-login; the account is created either way */
  }
  return res;
}
