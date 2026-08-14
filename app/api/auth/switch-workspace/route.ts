import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  SESSION_COOKIE,
  SESSION_TTL_MS,
  signSession,
  verifySession,
  currentUserId,
  currentOrgId,
  isOperatorSession,
  type SessionClaims,
} from "@/app/_lib/auth/session";
import { getWorkspace, getWorkspaceOrgId, DEFAULT_WORKSPACE_ID } from "@/app/_lib/db/workspaces";
import { getMembership } from "@/app/_lib/db/memberships";
import { canSwitchWorkspace } from "@/app/_lib/workspace-lock";
import { jsonError } from "@/app/_lib/api-response";


// Workspace switch (P2) — re-mint the session cookie with the chosen workspace, so
// currentWorkspace() (and the scoped stores) resolve to it. This route is under
// /api/auth/ (proxy-allow-listed), so it SELF-GUARDS: a valid session is required,
// and the target workspace must exist (never mint a session for a phantom tenant).
export async function POST(request: Request) {
  try {
    const jar = await cookies();
    const session = verifySession(jar.get(SESSION_COOKIE)?.value);
    if (!session) {
      return NextResponse.json({ error: "Sign in to switch workspaces." }, { status: 401 });
    }
    const body = (await request.json().catch(() => ({}))) as { workspaceId?: unknown };
    const workspaceId = typeof body.workspaceId === "string" ? body.workspaceId : "";
    // Fail-safe lock: with the data layer single-tenant, switching to any non-default
    // workspace would surface the first tenant's unscoped data (tri-scan #1). Only the
    // default is a valid target until KP_MULTI_WORKSPACE is set.
    if (workspaceId && !canSwitchWorkspace(workspaceId, DEFAULT_WORKSPACE_ID)) {
      return NextResponse.json(
        { error: "Switching workspaces is disabled until per-workspace data isolation is complete." },
        { status: 403 }
      );
    }
    if (!workspaceId || !getWorkspace(workspaceId)) {
      return NextResponse.json({ error: "Unknown workspace." }, { status: 404 });
    }
    // MEMBERSHIP is the authority to enter a team — existence never was. This route
    // used to mint a session for any workspace that merely existed, leaving the
    // real check to the empty-capability 403s every downstream route would then
    // return; with multi-workspace on that let any signed-in user park a session on
    // any tenant. Two conditions now, both fail-closed:
    //   1. the target belongs to the caller's own organization, and
    //   2. the caller actually holds a membership there.
    // Org-wide ADMINS can administer a team they don't belong to (seats, rename) —
    // but administering is not entering: without a membership their capabilities
    // inside it resolve empty, so switching would only strand them in a workspace
    // that answers 403 to everything. Operator / open-dev sessions carry no user
    // identity and keep their existing free rein.
    const userId = currentUserId(session);
    if (userId) {
      const sessionOrg = currentOrgId(session);
      if (sessionOrg && getWorkspaceOrgId(workspaceId) !== sessionOrg) {
        return NextResponse.json({ error: "Unknown workspace." }, { status: 404 });
      }
      if (!getMembership(userId, workspaceId)) {
        return NextResponse.json({ error: "You are not a member of that workspace." }, { status: 403 });
      }
    }
    // Carry the caller's identity across the re-mint. Dropping it used to hand the new
    // cookie to resolveCaller() with no `sub`, which read that absence as "operator" and
    // granted owner capabilities — so any member could switch to the default workspace and
    // return an owner. `role` is recomputed against the TARGET team (a user's role is
    // per-membership, not global); capabilities are still resolved live from the DB, so the
    // claim is for display and must never be the authority.
    const res = NextResponse.json({ ok: true, workspace: workspaceId });
    const claims: SessionClaims = isOperatorSession(session)
      ? { op: true }
      : {
          sub: userId ?? undefined,
          org: currentOrgId(session) ?? undefined,
          role: userId ? getMembership(userId, workspaceId)?.role : undefined,
        };
    res.cookies.set(SESSION_COOKIE, signSession(workspaceId, Date.now(), claims), {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: Math.floor(SESSION_TTL_MS / 1000),
    });
    return res;
  } catch (error) {
    return jsonError(error, "Failed to switch workspace.");
  }
}
