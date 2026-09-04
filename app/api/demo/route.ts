import { NextResponse, type NextRequest } from "next/server";
import { demoSessionAllowed } from "@/app/_lib/workspace-lock";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";
import { jsonRefusal } from "@/app/_lib/api-response";


// Public, anonymous entry to the guided product simulation (B1 / UAT).
//
// WHAT THIS DOOR CAN HONESTLY DO TODAY — the previous version of this comment
// claimed the opposite, and the walk's own comments quoted it:
//
//   * OPEN deploy (no KP_SECRET / no operator password): the fail-closed proxy
//     passes everything through and `resolveCaller()` hands out OWNER_CAPS, so the
//     scripted walk really does run. No cookie is needed — and `signSession()`
//     would throw without the secret. This is the demo path that works.
//   * GATED deploy: minting a "demo"-workspace session does NOT make the walk
//     work. `resolveCaller()` (app/_lib/auth/current-user.ts) treats a
//     DEMO_WORKSPACE session as `{ authed: false, caps: EMPTY_CAPS }`, so the
//     walk's very first write — POST /api/jds/save, which requires an operator
//     with `jd:write` — answers 401, and so do /api/decisions/screen-wave and
//     /api/schedule/invite. Nothing seeds the "demo" workspace either, so even a
//     permitted walk would source zero applicants and halt on "intake returned
//     none". The session was a door onto a room with no floor.
//
// So a gated deploy REFUSES here with a code the landing renders, instead of
// minting a session and letting the prospect discover the 401 four steps into a
// narrated tour. Two distinct reasons, because they are two distinct operator
// actions: DEMO_DISABLED (KP_DEMO_ENABLED is off — turn it on) and
// DEMO_NOT_PROVISIONED (it is on, but the demo tenant has no capabilities and no
// corpus — nothing the operator can flip today).
//
// Granting a demo session `pipeline:write` inside the isolated demo tenant and
// seeding that tenant at first mint is an OWNER DECISION (it re-opens the
// blast-radius question for jds/save, screen-wave and schedule/invite). It is
// deliberately not built here; when it is, this branch becomes the mint again.

/** Query param the landing reads to name the refusal (DemoUnavailableNotice). */
const UNAVAILABLE_PATH = "/?demo=unavailable&code=";

export async function GET(request: NextRequest) {
  // Abuse containment: on an open deploy this lands on a run that seeds rows.
  // Per-IP fixed window, same tool as the public token routes.
  if (!rateLimit(`demo:${clientIpFrom(request.headers)}`, { limit: 12, windowMs: 10 * 60_000 })) {
    return jsonRefusal("TOO_MANY_REQUESTS", 429);
  }

  if (process.env.KP_SECRET) {
    const code = demoSessionAllowed() ? "DEMO_NOT_PROVISIONED" : "DEMO_DISABLED";
    return NextResponse.redirect(new URL(`${UNAVAILABLE_PATH}${code}`, request.url));
  }

  // Open deploy: land on '/?sim=auto', which auto-starts the run (see
  // SimulationProvider). The marketing "Try the live demo" CTA points here.
  return NextResponse.redirect(new URL("/?sim=auto", request.url));
}
