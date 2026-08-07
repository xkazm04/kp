import { cookies } from "next/headers";
import { connection } from "next/server";
import { SESSION_COOKIE, ENTERED_COOKIE, verifySession, currentWorkspaceId, DEMO_WORKSPACE } from "./session";

// Server-side homepage gate (replaces the old client localStorage HomeGate): does
// '/' render the dashboard, or the public landing? Decided per request so the
// landing is server-rendered for anonymous visitors (crawlable, no flash).
//
//  - Password mode (KP_OPERATOR_PASSWORD set): the answer is the REAL signed
//    session — present, verifying, and not the anonymous demo workspace. The
//    plain entry marker is not trusted here (it's spoofable); the signature is.
//  - Open mode (no KP_OPERATOR_PASSWORD): the app is fully open and no signed
//    session may even exist (KP_SECRET can be unset), so the readable entry marker
//    set by enterWorkspace() drives the toggle. That's fine — in open mode the
//    dashboard has no auth boundary to protect anyway.
//
// Deliberately depends only on session.ts (cookie verify), NOT current-user.ts, so
// it stays free of the DB/membership layer the homepage doesn't need.
export async function hasEnteredWorkspace(): Promise<boolean> {
  try {
    const jar = await cookies();
    if (process.env.KP_OPERATOR_PASSWORD) {
      // Request-time by construction: verifySession reads the wall clock to check
      // expiry, which the Cache Components prerender refuses to bake in. Same
      // reason as currentSession() in current-user.ts — only inside the password
      // branch, since the open-mode marker read below needs no clock.
      await connection();
      const session = verifySession(jar.get(SESSION_COOKIE)?.value);
      return session !== null && currentWorkspaceId(session) !== DEMO_WORKSPACE;
    }
    return jar.get(ENTERED_COOKIE)?.value === "1";
  } catch {
    // Outside a request scope (build/prerender) cookies() throws → treat as
    // anonymous so the landing is what gets statically considered.
    return false;
  }
}
