import { NextResponse } from "next/server";
import { clearSession } from "@/app/_lib/auth/session-issuer";


// Auth foundation (P2). Clear the session cookie AND the readable entry marker
// (session.ts) so '/' falls back to the public landing. The issuer's clearSession
// uses the same attributes as the set, so the browser actually overwrites/expires each.
export async function POST() {
  return clearSession(NextResponse.json({ ok: true }));
}
