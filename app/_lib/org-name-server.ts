import { cookies } from "next/headers";
import { getBrand } from "./brand-store";
import { fixtureSeedEnabled } from "./db/seed-gate";
import { requireOrgCapability } from "./auth/current-user";
import { currentWorkspace } from "./auth/current-workspace";
import { getOrganization, setOrganizationName } from "./db/organizations";
import { getWorkspaceOrgId } from "./db/workspaces";
import { isOwnOrgName, ORG_NAME_COOKIE, pickOrgName, resolveOrgName, sanitizeOrgName } from "./org-settings";


// The server half of "whose role is this?". The company name lives on the caller's
// organization row (organizations.name) and, when the brand was still the default,
// on the brand row. A role created with its company field blank used to
// be stored with NO company, so the apply page a candidate opened named nobody. Every
// server door that creates a role a candidate can apply to fills a blank company from
// here — never over a company the user typed (`companyOrDefault`).

/** The brand's display name, or null when it cannot be read: a missing brand must
 *  degrade to the seed fallback, never fail the write that asked. */
function brandDisplayName(): string | null {
  try {
    return getBrand().displayName;
  } catch {
    /* best-effort: the brand row only names the company, the role write is the request */
    return null;
  }
}

/** The caller's org id, or null outside a request scope / for an unlinked legacy
 *  workspace. */
async function callerOrgId(): Promise<string | null> {
  try {
    return getWorkspaceOrgId(await currentWorkspace());
  } catch {
    /* no request scope (a detached task): there is no caller, so no org to read */
    return null;
  }
}

async function legacyCookieName(): Promise<string> {
  try {
    return resolveOrgName((await cookies()).get(ORG_NAME_COOKIE)?.value);
  } catch {
    /* no request scope: no browser, no cookie */
    return "";
  }
}

/** The organization's own name for `orgId` — organizations.name is the authority
 *  (owner decision 2026-10-22, org-actions.ts) — or "" while the org has none.
 *
 *  MIGRATE ON READ: an org still on its placeholder/demo name whose caller carries a
 *  legacy `kp_org_name` cookie adopts that cookie's value once, then the cookie is
 *  cleared. Only a caller holding `org:manage` migrates (a cookie is client-controlled;
 *  the write is an administrator's act like setOrgName), and the write is a
 *  compare-and-swap on the name that was read so a concurrent rename wins. */
export async function readOrgName(orgId: string | null): Promise<string> {
  if (!orgId) return "";
  const org = getOrganization(orgId);
  if (org && isOwnOrgName(org.name)) return sanitizeOrgName(org.name);
  const legacy = await legacyCookieName();
  if (!legacy || !org || (await requireOrgCapability("org:manage")) !== null) return "";
  if (isOwnOrgName(legacy)) {
    setOrganizationName(orgId, legacy, { currentName: org.name });
  }
  try {
    (await cookies()).delete(ORG_NAME_COOKIE);
  } catch {
    /* best-effort: a server component cannot set cookies; the next route handler read clears it */
  }
  const after = getOrganization(orgId);
  return after && isOwnOrgName(after.name) ? sanitizeOrgName(after.name) : "";
}

/** The effective org name for THIS request: the org row → brand display name → the
 *  seed gate's fallback (the demo's company on a seeded install, else empty). Outside
 *  a request scope (a detached task) there is no caller org; the brand row and the seed
 *  gate still answer, so the same helper is safe to call there. */
export async function effectiveOrgName(): Promise<string> {
  const own = await readOrgName(await callerOrgId());
  return pickOrgName(own, brandDisplayName(), fixtureSeedEnabled());
}
