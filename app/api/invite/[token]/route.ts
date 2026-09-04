import { NextResponse, type NextRequest } from "next/server";
import { ENTERED_COOKIE, SESSION_COOKIE, SESSION_TTL_MS, signSession } from "@/app/_lib/auth/session";
import { getRedeemableInvite } from "@/app/_lib/db/invites";
import { getOrganization } from "@/app/_lib/db/organizations";
import { getUserByEmail } from "@/app/_lib/db/users";
import { acceptInvite, MIN_PASSWORD_LENGTH } from "@/app/_lib/org-service";
import { clientIpFrom } from "@/app/_lib/rate-limit";
import { jsonRefusal } from "@/app/_lib/api-response";
import { isThrottled, recordFailedAttempt, type ThrottleOpts } from "@/app/_lib/auth/login-throttle";
import { BODY_TOO_LARGE, readJsonWithLimit } from "@/app/_lib/request-body";

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
//
// PERSISTED, not in-process (wave 23). This budget shipped on rate-limit.ts's
// in-memory Map while its two siblings into the same tenant — /api/auth/login and
// /api/auth/register — use the multi-process store in auth/login-throttle.ts. kp
// can run as several workers over one kp.sqlite (a PM2 cluster, more than one
// instance), and a per-process Map hands the flood one FULL budget PER WORKER: the
// door that creates a user, a membership and a session cookie was the one carrying
// the weakest counter. Same shape as register — EVERY attempt counts, success
// included, because what is bounded here is account provisioning and invitee
// disclosure, not credential guessing — and the key still carries the client AND
// the token, so one leaked link cannot spend another invitee's budget.
const INVITE_THROTTLE: ThrottleOpts = { limit: 10, windowMs: 60_000 };

export async function GET(request: NextRequest, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const viewKey = `invite-view:${clientIpFrom(request.headers)}:${token}`;
  if (isThrottled(viewKey, INVITE_THROTTLE)) {
    return jsonRefusal("TOO_MANY_REQUESTS", 429);
  }
  recordFailedAttempt(viewKey, INVITE_THROTTLE);
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

/** Hard cap on this public door's request body: a display name and a password — an unauthenticated account-creation door.
 *  Enforced on the BYTES READ, not on the caller's content-length (request-body.ts). */
const MAX_INVITE_BODY_BYTES = 8 * 1024;

export async function POST(request: NextRequest, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  // Throttle BEFORE the body is even read: the redeem path writes a user, a
  // membership and a session, so the flood must be refused at the door.
  const redeemKey = `invite-redeem:${clientIpFrom(request.headers)}:${token}`;
  if (isThrottled(redeemKey, INVITE_THROTTLE)) {
    return jsonRefusal("TOO_MANY_REQUESTS", 429);
  }
  recordFailedAttempt(redeemKey, INVITE_THROTTLE);
  const body = await readJsonWithLimit<{ name?: unknown; password?: unknown }>(request, MAX_INVITE_BODY_BYTES, {});
  if (body === BODY_TOO_LARGE) return jsonRefusal("PAYLOAD_TOO_LARGE", 413, { maxBytes: MAX_INVITE_BODY_BYTES });
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
    const maxAge = Math.floor(SESSION_TTL_MS / 1000);
    res.cookies.set(SESSION_COOKIE, session, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge,
    });
    // …and the readable "entered the workspace" marker, exactly as login and
    // register set it (auth/login/route.ts, auth/register/route.ts). Without it a
    // redeemed member was signed in and then bounced: AcceptForm redirects to '/',
    // and in OPEN mode (no KP_OPERATOR_PASSWORD) the '/' gate reads ONLY this
    // marker (home-gate-server.ts), so it rendered the public landing to somebody
    // who had just joined the team. Not a credential — the session is.
    res.cookies.set(ENTERED_COOKIE, "1", { httpOnly: false, secure: true, sameSite: "lax", path: "/", maxAge });
  } catch {
    /* KP_SECRET unavailable — skip auto-login; the account is created either way */
  }
  return res;
}
