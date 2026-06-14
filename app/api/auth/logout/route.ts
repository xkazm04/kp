import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/app/_lib/auth/session";

export const runtime = "nodejs";

// Auth foundation (P2). Clear the session cookie. Same attributes as the set so
// the browser actually overwrites/expires it.
export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return res;
}
