import { NextResponse } from "next/server";
import { callerCapabilities, currentSession } from "@/app/_lib/auth/current-user";
import { currentUserId, currentWorkspaceId, DEMO_WORKSPACE, isOperatorSession } from "@/app/_lib/auth/session";
import { getUserById } from "@/app/_lib/db/users";

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
//
// `session` — the caller's OWN session facts, for the shell's lapse warning
// (app/features/shell/session/sessionLapse.ts): kind, user id, own email, workspace,
// and the verified token's expiry. The ungated reasoning holds only because this is
// strictly the caller's own: never a hash, never another member's row. null in open
// mode (nothing ever lapses there), with no signed cookie, for the guided demo (not
// re-sign-in-able), and for an identity-less non-operator cookie (not a sign-in).
type SessionFactsWire = {
  kind: "user" | "operator";
  userId: string | null;
  email: string | null;
  workspaceId: string;
  expiresAt: number;
};

async function sessionFacts(): Promise<SessionFactsWire | null> {
  if (!process.env.KP_OPERATOR_PASSWORD) return null;
  const s = await currentSession();
  if (!s || currentWorkspaceId(s) === DEMO_WORKSPACE) return null;
  const workspaceId = currentWorkspaceId(s);
  if (isOperatorSession(s)) return { kind: "operator", userId: null, email: null, workspaceId, expiresAt: s.exp };
  const userId = currentUserId(s);
  const user = userId ? getUserById(userId) : null;
  if (!user) return null;
  return { kind: "user", userId: user.id, email: user.email, workspaceId, expiresAt: s.exp };
}

export async function GET() {
  const [capabilities, session] = await Promise.all([callerCapabilities(), sessionFacts()]);
  return NextResponse.json({ capabilities, session });
}
