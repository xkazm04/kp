import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { SESSION_COOKIE, SESSION_TTL_MS, signSession } from "@/app/_lib/auth/session";

export const runtime = "nodejs";

// Constant-time compare via fixed-length sha256 digests (no length-leak, no early
// return) — the operator password is the only secret here.
function constantTimeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

// Auth foundation (P2). Operator login → a signed __Host- session cookie. Auth is
// opt-in: with KP_OPERATOR_PASSWORD unset the app runs open (middleware passes
// through) and login is 503 (nothing to log into).
export async function POST(request: Request) {
  const expected = process.env.KP_OPERATOR_PASSWORD;
  if (!expected) {
    return NextResponse.json({ error: "Operator auth is not configured." }, { status: 503 });
  }
  const body = (await request.json().catch(() => ({}))) as { password?: unknown };
  const password = typeof body.password === "string" ? body.password : "";
  if (!password || !constantTimeEqual(password, expected)) {
    return NextResponse.json({ error: "Incorrect password." }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  // __Host- requires Secure + Path=/ + no Domain. Secure is accepted on
  // http://localhost (a trustworthy origin), so this works in dev too.
  res.cookies.set(SESSION_COOKIE, signSession(), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
  return res;
}
