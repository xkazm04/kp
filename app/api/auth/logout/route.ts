import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySession } from "@/app/_lib/auth/session";
import { revokeAllSessions, revokeSession } from "@/app/_lib/auth/session-revocation";
import { clearSession } from "@/app/_lib/auth/session-issuer";
import { jsonRefusal } from "@/app/_lib/api-response";
import { BODY_TOO_LARGE, readJsonWithLimit } from "@/app/_lib/request-body";


// Auth foundation (P2). Clear the session cookie AND the readable entry marker
// (session.ts) so '/' falls back to the public landing. The issuer's clearSession
// uses the same attributes as the set, so the browser actually overwrites/expires each.
//
// CLEARING A COOKIE IS NOT SIGNING OUT. The token is a stateless signed bearer
// credential: expiring the browser's copy does nothing to any other copy, so a cookie
// lifted off a stolen laptop stayed valid for the remainder of its 7-day TTL and the
// only answer was `KP_SESSION_EPOCH`, which signs out the whole deployment. This route
// now also writes the session to the revocation list (auth/session-revocation.ts), which
// the proxy gate and every session read consult — so the copy the operator no longer
// holds dies with the one they do.
//
// Two scopes on one door, because they are the same intent at different blast radii:
//   • default            → revoke THIS session. The sidebar's sign-out.
//   • { allDevices: true } → revoke every session of this principal issued before now.
//     The enterprise "sign out all devices" action, and the correct response to a lost
//     device: it costs one row no matter how many cookies are out there, and it is
//     reachable from any OTHER device the person can still sign in on.
//
// SELF-GUARDING, like its /api/auth/ siblings: the route is proxy-public, and the
// authority to revoke is the cookie the caller presents. No session ⇒ nothing is
// written, so an anonymous caller cannot revoke anyone (nor grow the table).
/** Hard cap on this public door's request body: one boolean.
 *  Enforced on the BYTES READ, not on the caller's content-length (request-body.ts). */
const MAX_LOGOUT_BODY_BYTES = 1024;

export async function POST(request: Request) {
  const body = await readJsonWithLimit<{ allDevices?: unknown }>(request, MAX_LOGOUT_BODY_BYTES, {});
  if (body === BODY_TOO_LARGE) return jsonRefusal("PAYLOAD_TOO_LARGE", 413, { maxBytes: MAX_LOGOUT_BODY_BYTES });
  const allDevices = body.allDevices === true;

  // `revoked` is reported truthfully — never a green lie. A logout with no verifiable
  // session (open dev with no KP_SECRET, an already-expired cookie) still clears the
  // browser and still answers ok, but it revoked nothing and says so.
  let revoked = false;
  try {
    const jar = await cookies();
    const session = verifySession(jar.get(SESSION_COOKIE)?.value);
    if (session && allDevices) {
      revokeAllSessions(session, "logout:all-devices");
      revoked = true;
    } else if (session) {
      // False only for a session carrying no usable `iat` — it cannot be named
      // individually, and `allDevices` is the scope that covers it.
      revoked = revokeSession(session, "logout");
    }
  } catch (err) {
    // Best-effort: a revocation store that cannot be written must not strand the
    // operator on a page they are trying to leave. The cookie clearing below is
    // unconditional, and `revoked: false` tells the caller the server-side half did
    // not happen — the escalation from there is KP_SESSION_EPOCH.
    console.error("[api:auth/logout] failed to record the session revocation", err);
  }

  // The issuer owns every attribute of both cookies, so this clears with the same ones the set used.
  return clearSession(NextResponse.json({ ok: true, revoked, scope: allDevices ? "all-devices" : "session" }));
}
