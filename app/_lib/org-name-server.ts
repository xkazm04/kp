import { cookies } from "next/headers";
import { getBrand } from "./brand-store";
import { fixtureSeedEnabled } from "./db/seed-gate";
import { ORG_NAME_COOKIE, pickOrgName } from "./org-settings";

// The server half of "whose role is this?". The first-run wizard stores the company
// name per browser (`kp_org_name`, an owner decision) and, when the brand was still
// the default, on the brand row. A role created with its company field blank used to
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

/** The effective org name for THIS request: cookie → brand display name → the seed
 *  gate's fallback (the demo's company on a seeded install, else empty). Outside a
 *  request scope (a detached task) `cookies()` throws; the brand row and the seed gate
 *  still answer, so the same helper is safe to call there. */
export async function effectiveOrgName(): Promise<string> {
  let raw: string | undefined;
  try {
    raw = (await cookies()).get(ORG_NAME_COOKIE)?.value;
  } catch {
    /* no request scope: there is no browser to read a cookie from, the deployment sources follow */
    raw = undefined;
  }
  return pickOrgName(raw, brandDisplayName(), fixtureSeedEnabled());
}
