import { cookies } from "next/headers";
import { DEFAULT_ORG_NAME, ORG_NAME_COOKIE, sanitizeOrgName } from "./org-settings";
import { getBrand } from "./brand-store";
import { hasJdCaseArtifact, listJdsPage } from "./db/jobs";
import { listDevCases } from "./db/devcase";
import { listChannelWebhooks } from "./db/channels";
import { listUsersByOrg } from "./db/users";
import { listInvitesForOrg } from "./db/invites";
import { DEFAULT_ORG_ID, getOrganization } from "./db/organizations";
import { isRelayConfigured } from "./comms-relay";

// Getting-started checklist derivation (server-side). Every step is DATA-DERIVED
// from what actually exists — no per-step flags to drift out of sync with
// reality: doing the work through any door (wizard, Library, API) completes the
// step. Consumed by GET /api/me/getting-started for the Pipeline-board card.

export type FirstRoleState = "none" | "analyzing" | "failed" | "ready";
export type ChannelsState = "none" | "listening" | "verified";

export type GettingStarted = {
  /** The company step is done. See `companySignal` for what was actually read. */
  company: boolean;
  /** WHICH signal decided `company`, because the two are not equally trustworthy:
   *  - `"org"` — the caller's own organization row carries a name of its own. Tenant-
   *    scoped: one org's answer can never tick another's box.
   *  - `"deployment"` — no org on the session, so the fallback is the deployment-wide
   *    brand singleton plus the caller's own `kp_org_name` cookie. Both are correct
   *    for the single-tenant/open-dev install this branch serves and NEITHER is
   *    per-tenant, which is exactly why the branch is named on the wire instead of
   *    being invisible.
   *  Optional so an existing GettingStarted literal (the model's own fixtures) still
   *  type-checks; the route always sends it. */
  companySignal?: "org" | "deployment";
  /** Ready = a usable JD exists (a finished build OR a saved draft). */
  firstRole: FirstRoleState;
  /** A dev case exists, or a JD build produced its case artifact. */
  caseDesigned: boolean;
  /** verified = an intake webhook has actually received traffic. */
  channels: ChannelsState;
  /** Bonus step — more than one member, or a pending invite. */
  team: boolean;
  /** The four core steps (team excluded) are complete. */
  allDone: boolean;
};

/** The company step, and the signal it was decided from.
 *
 *  It used to be `cookie OR brand`, and BOTH halves lie on a multi-tenant box:
 *  `getBrand()` is a deployment-wide SINGLETON (one `brand_settings` row, id fixed —
 *  brand-store.ts), so the first tenant to upload a logo ticked this step for every
 *  other tenant on the install; and `kp_org_name` is the CALLER'S OWN cookie, so the
 *  same tenant read a tick or a blank depending on which browser they opened.
 *
 *  When the session carries an org we now read the ORG ROW — the only per-tenant name
 *  the app stores. `name` is required at creation (createOrganization defaults it to
 *  "Untitled organization"), so the test is "a name of your own": non-empty, and
 *  neither the placeholder nor the seed corpus's ČS default that every fresh install
 *  starts on.
 *
 *  Without an org on the session (open dev, the single-tenant install, a legacy
 *  session minted before orgs) there IS no tenant-scoped signal, so the old
 *  deployment-wide read stands unchanged — and says so through `companySignal`
 *  rather than passing itself off as a per-tenant fact. Making the brand singleton
 *  per-workspace is an owner decision and explicitly out of scope here. */
export function companyStep(
  rawOrgNameCookie: string | null | undefined,
  brand: { displayName: string | null; accentColor: string | null; logoUrl: string | null },
  org: { name: string } | null
): { company: boolean; companySignal: "org" | "deployment" } {
  if (org) {
    const name = org.name.trim();
    return { company: name.length > 0 && name !== DEFAULT_ORG_NAME && name !== "Untitled organization", companySignal: "org" };
  }
  const cookieName = rawOrgNameCookie ? sanitizeOrgName(rawOrgNameCookie) : "";
  return {
    company: Boolean(cookieName || brand.displayName || brand.accentColor || brand.logoUrl),
    companySignal: "deployment",
  };
}

export async function computeGettingStarted(workspaceId: string, orgId: string | null): Promise<GettingStarted> {
  const jar = await cookies();
  // "Set" means the operator stored a name — the raw cookie, not resolveOrgName
  // (whose ČS fallback would mark a untouched tenant complete).
  const rawName = jar.get(ORG_NAME_COOKIE)?.value;
  const brand = getBrand();
  // Only a session that actually carries an org gets the tenant-scoped branch:
  // falling back to DEFAULT_ORG_ID here would answer for the seeded org on behalf
  // of a caller who is not in it.
  const { company, companySignal } = companyStep(rawName, brand, orgId ? getOrganization(orgId) : null);

  // A PAGE, deliberately: this step asks "does a first role exist and how is it
  // doing", which the newest 100 answer — `truncated` would change no branch below
  // (a truncated page is never empty, so `firstRole` can only be "none" when the
  // library really is). Named as a page so the next reader does not mistake
  // `.jds.length` for a library total.
  const { jds } = listJdsPage(100, workspaceId);
  // A NULL analysis_status is a plain saved draft — usable, so it counts as done.
  const firstRole: FirstRoleState =
    jds.length === 0
      ? "none"
      : jds.some((j) => j.analysis_status === "ready" || j.analysis_status == null)
        ? "ready"
        : jds.some((j) => j.analysis_status === "analyzing")
          ? "analyzing"
          : "failed";

  const caseDesigned = listDevCases(1, workspaceId).length > 0 || hasJdCaseArtifact(workspaceId);

  const { webhooks } = listChannelWebhooks(workspaceId);
  const channels: ChannelsState = webhooks.some((w) => w.receivedCount > 0)
    ? "verified"
    : webhooks.length > 0 || isRelayConfigured()
      ? "listening"
      : "none";

  const org = orgId ?? DEFAULT_ORG_ID;
  const team = listUsersByOrg(org).length > 1 || listInvitesForOrg(org, "pending").length > 0;

  return {
    company,
    companySignal,
    firstRole,
    caseDesigned,
    channels,
    team,
    allDone: company && firstRole === "ready" && caseDesigned && channels === "verified",
  };
}
