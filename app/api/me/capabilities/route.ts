import { NextResponse } from "next/server";
import { callerCapabilities } from "@/app/_lib/auth/current-user";

// What THIS caller may do here — the one read the shell needs to stop offering
// doors it knows are locked (app/features/shell/navCapabilities.ts).
//
// A dedicated route rather than reusing GET /api/org/members' `callerCapabilities`,
// for three reasons:
//   • That payload is the org's MEMBER ROSTER — every colleague's name, email and
//     role. Fetching the whole team's identities on every workspace mount to learn
//     one's own permissions is the wrong trade, and it is a bigger read to keep
//     warm than the six strings the nav actually branches on.
//   • It answers 403 for a caller without `read`, and 401 for one without a
//     session. The shell must still render for them (they see a locked nav, not a
//     blank page), so its capability read must always succeed — the empty set IS
//     the answer, not an error.
//   • Open dev mode and an operator-password session hold NO membership row at
//     all; they fold to owner inside callerCapabilities(). The roster route would
//     have to be read for a side effect to learn that.
//
// No gate: a principal asking what they themselves may do learns nothing they did
// not already have (the capability set is derived from their own session), and
// nothing is created by asking. The same reasoning as GET /api/me/onboarding.
export async function GET() {
  return NextResponse.json({ capabilities: await callerCapabilities() });
}
