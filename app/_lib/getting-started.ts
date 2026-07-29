import { cookies } from "next/headers";
import { ORG_NAME_COOKIE, sanitizeOrgName } from "./org-settings";
import { getBrand } from "./brand-store";
import { hasJdCaseArtifact, listJds } from "./db/jobs";
import { listDevCases } from "./db/devcase";
import { listChannelWebhooks } from "./db/channels";
import { listUsersByOrg } from "./db/users";
import { listInvitesForOrg } from "./db/invites";
import { DEFAULT_ORG_ID } from "./db/organizations";
import { isRelayConfigured } from "./comms-relay";

// Getting-started checklist derivation (server-side). Every step is DATA-DERIVED
// from what actually exists — no per-step flags to drift out of sync with
// reality: doing the work through any door (wizard, Library, API) completes the
// step. Consumed by GET /api/me/getting-started for the Pipeline-board card.

export type FirstRoleState = "none" | "analyzing" | "failed" | "ready";
export type ChannelsState = "none" | "listening" | "verified";

export type GettingStarted = {
  /** Org name explicitly set, or any white-label brand field configured. */
  company: boolean;
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

export async function computeGettingStarted(workspaceId: string, orgId: string | null): Promise<GettingStarted> {
  const jar = await cookies();
  // "Set" means the operator stored a name — the raw cookie, not resolveOrgName
  // (whose ČS fallback would mark a untouched tenant complete).
  const rawName = jar.get(ORG_NAME_COOKIE)?.value;
  const brand = getBrand();
  const company = Boolean((rawName && sanitizeOrgName(rawName)) || brand.displayName || brand.accentColor || brand.logoUrl);

  const jds = listJds(100, workspaceId);
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

  const webhooks = listChannelWebhooks(workspaceId);
  const channels: ChannelsState = webhooks.some((w) => w.receivedCount > 0)
    ? "verified"
    : webhooks.length > 0 || isRelayConfigured()
      ? "listening"
      : "none";

  const org = orgId ?? DEFAULT_ORG_ID;
  const team = listUsersByOrg(org).length > 1 || listInvitesForOrg(org, "pending").length > 0;

  return {
    company,
    firstRole,
    caseDesigned,
    channels,
    team,
    allDone: company && firstRole === "ready" && caseDesigned && channels === "verified",
  };
}
