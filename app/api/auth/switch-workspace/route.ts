import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE, SESSION_TTL_MS, signSession, verifySession } from "@/app/_lib/auth/session";
import { getWorkspace } from "@/app/_lib/db";
import { jsonError } from "@/app/_lib/api-response";

export const runtime = "nodejs";

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
    if (!workspaceId || !getWorkspace(workspaceId)) {
      return NextResponse.json({ error: "Unknown workspace." }, { status: 404 });
    }
    const res = NextResponse.json({ ok: true, workspace: workspaceId });
    res.cookies.set(SESSION_COOKIE, signSession(workspaceId), {
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
