import { NextResponse } from "next/server";
import { ENTERED_COOKIE, SESSION_COOKIE } from "@/app/_lib/auth/session";


// Auth foundation (P2). Clear the session cookie AND the readable entry marker
// (session.ts) so '/' falls back to the public landing. Same attributes as the
// set so the browser actually overwrites/expires each.
export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  res.cookies.set(ENTERED_COOKIE, "", { httpOnly: false, secure: true, sameSite: "lax", path: "/", maxAge: 0 });
  return res;
}
