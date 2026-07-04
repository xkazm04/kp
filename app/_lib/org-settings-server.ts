import { cookies } from "next/headers";
import { ORG_NAME_COOKIE, resolveOrgName } from "./org-settings";

// Server-side effective org name (route handlers + server components). Reads the
// cookie the Organization settings page writes; falls back to the default outside
// a request scope (a background task / script) where `cookies()` throws — the same
// defensive shape as currentWorkspace() and getServerLocale().
export async function getOrgName(): Promise<string> {
  try {
    const jar = await cookies();
    return resolveOrgName(jar.get(ORG_NAME_COOKIE)?.value);
  } catch {
    return resolveOrgName(null);
  }
}
