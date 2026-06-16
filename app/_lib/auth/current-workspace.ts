import { cookies } from "next/headers";
import { SESSION_COOKIE } from "./edge-verify";
import { currentWorkspaceId, DEFAULT_WORKSPACE, verifySession } from "./session";

// Tenant resolver for REQUEST scope (route handlers + server components): read the
// session cookie → its workspace. Outside a request (a background task, a script)
// `cookies()` throws → we fall back to the single default workspace. Background
// work that must target a specific workspace carries it explicitly on the task
// (params), never via this resolver.
export async function currentWorkspace(): Promise<string> {
  try {
    const jar = await cookies();
    return currentWorkspaceId(verifySession(jar.get(SESSION_COOKIE)?.value));
  } catch {
    return DEFAULT_WORKSPACE;
  }
}
