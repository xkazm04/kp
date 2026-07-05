import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { ENTERED_COOKIE, SESSION_COOKIE, SESSION_TTL_MS, signSession } from "@/app/_lib/auth/session";
import { verifyCredentials } from "@/app/_lib/db/users";
import { listMembershipsForUser } from "@/app/_lib/db/memberships";
import { DEFAULT_WORKSPACE_ID } from "@/app/_lib/db/workspaces";

// Constant-time compare via fixed-length sha256 digests (no length-leak, no early
// return) — the operator password is the only secret on that path.
function constantTimeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

const COOKIE_MAX_AGE = Math.floor(SESSION_TTL_MS / 1000);

// The readable "entered the workspace" marker (see session.ts) — set on every
// successful sign-in so the '/' gate + theme script can distinguish an entered
// operator from an anonymous landing visitor. Not a credential; the session is.
function setEntered(res: NextResponse): NextResponse {
  res.cookies.set(ENTERED_COOKIE, "1", { httpOnly: false, secure: true, sameSite: "lax", path: "/", maxAge: COOKIE_MAX_AGE });
  return res;
}

function withSessionCookie(res: NextResponse, token: string): NextResponse {
  // __Host- requires Secure + Path=/ + no Domain. Secure is accepted on
  // http://localhost (a trustworthy origin), so this works in dev too.
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  });
  return setEntered(res);
}

// Auth foundation. Two login paths on one endpoint:
//   • Per-user (P0): { email, password } → an identity-carrying session scoped to
//     the user's first team. Independent of KP_OPERATOR_PASSWORD (a real user is
//     its own credential).
//   • Operator (legacy): { password } → the single-shared-password session. Opt-in;
//     503 when KP_OPERATOR_PASSWORD is unset (nothing to log into).
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { email?: unknown; password?: unknown };
  const password = typeof body.password === "string" ? body.password : "";
  const email = typeof body.email === "string" ? body.email.trim() : "";

  if (email) {
    // Uniform 401 for both "no such user" and "wrong password" — never leak which.
    const user = password ? verifyCredentials(email, password) : null;
    if (!user) {
      return NextResponse.json({ error: "Incorrect email or password." }, { status: 401 });
    }
    // Land the user on their first team (by created_at) with that role. A user with
    // no team yet falls back to the default workspace with no role (read-gated).
    const primary = listMembershipsForUser(user.id)[0];
    const token = signSession(primary?.workspaceId ?? DEFAULT_WORKSPACE_ID, Date.now(), {
      sub: user.id,
      org: user.orgId,
      role: primary?.role,
    });
    return withSessionCookie(NextResponse.json({ ok: true }), token);
  }

  const expected = process.env.KP_OPERATOR_PASSWORD;
  if (!expected) {
    // Open mode: the app runs open by design (proxy.ts allows every route). There
    // is no password to check, so "signing in" is just entering the workspace —
    // it flips the '/' landing→dashboard gate, not a security boundary. Set the
    // entry marker; also mint a real session when KP_SECRET is configured (keeps
    // identity-scoped features working), but bare dev without KP_SECRET (signSession
    // throws) still enters on the marker alone.
    const res = NextResponse.json({ ok: true, open: true });
    try {
      return withSessionCookie(res, signSession());
    } catch {
      return setEntered(res);
    }
  }
  if (!password || !constantTimeEqual(password, expected)) {
    return NextResponse.json({ error: "Incorrect password." }, { status: 401 });
  }
  return withSessionCookie(NextResponse.json({ ok: true }), signSession());
}
