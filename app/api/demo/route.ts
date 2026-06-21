import { NextResponse, type NextRequest } from "next/server";
import { DEMO_WORKSPACE, SESSION_COOKIE, signSession } from "@/app/_lib/auth/session";
import { demoSessionAllowed } from "@/app/_lib/workspace-lock";
import { clientIpFrom, rateLimit, RATE_LIMITED_ERROR } from "@/app/_lib/rate-limit";

export const runtime = "nodejs";

// Public, anonymous entry to the guided product simulation (B1 / UAT). A prospect
// has no operator session, so the fail-closed proxy (proxy.ts) would 401 every
// recruiter API the sim drives. Rather than expose those APIs publicly, this mints
// a session SCOPED TO AN ISOLATED "demo" workspace: the proxy then lets the sim's
// calls through with a legitimate session, and currentWorkspace() (the tenancy
// seam) scopes every read/write to "demo" — so the keyless JD→Hired demo never
// touches the real seeded workspace. Lands on '/?sim=auto', which auto-starts the
// run (see SimulationProvider). The marketing "Try the live demo" CTA points here.
// A demo session is not a login — keep it short. One guided run is minutes.
const DEMO_SESSION_MAX_AGE_S = 60 * 60; // 1 hour

export async function GET(request: NextRequest) {
  // Abuse containment: this endpoint mints a session + the run seeds rows in the
  // demo workspace. Per-IP fixed window, same tool as the public token routes.
  if (!rateLimit(`demo:${clientIpFrom(request.headers)}`, { limit: 12, windowMs: 10 * 60_000 })) {
    return NextResponse.json({ error: RATE_LIMITED_ERROR }, { status: 429 });
  }

  // In an open dev deploy (no KP_SECRET / no operator password) the proxy passes
  // through, so no cookie is needed — and signSession() would throw without the
  // secret. In a gated deploy, mint the isolated demo session — but ONLY when the
  // public demo is explicitly allowed: while tenancy is half-built, this anonymous
  // recruiter session can read the real tenant's PII via the ~28 unscoped tables, so
  // by default a gated deploy refuses to mint it and just lands on the marketing page.
  if (process.env.KP_SECRET && !demoSessionAllowed()) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  const res = NextResponse.redirect(new URL("/?sim=auto", request.url));
  if (process.env.KP_SECRET) {
    res.cookies.set(SESSION_COOKIE, signSession(DEMO_WORKSPACE), {
      httpOnly: true,
      secure: true, // accepted on http://localhost too (matches /api/auth/login)
      sameSite: "lax",
      path: "/",
      maxAge: DEMO_SESSION_MAX_AGE_S,
    });
  }
  return res;
}
