import { NextResponse } from "next/server";
import { dumpOrg } from "@/app/_lib/db-portability";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { currentUser, requireOrgCapability } from "@/app/_lib/auth/current-user";
import { DEFAULT_ORG_ID } from "@/app/_lib/db/organizations";

// Download THE CALLER'S ORGANIZATION as one portable kp-org-dump JSON file:
// every team's data, the org's identity (users, memberships, invites) and its
// billing record. The import route restores it in place.
//
// This replaced a WHOLE-DATABASE dump. That version enumerated sqlite_master and
// did `SELECT * FROM <table>` with no predicate, so with KP_MULTI_WORKSPACE on any
// signed-in member could download every other team's candidates, contacts and
// transcripts in one request — which is why it was hard-refused (503) rather than
// shipped. The scope now comes from the tenancy manifest (`orgExportClass`), so a
// table nobody classified fails the coverage test instead of being handed over on
// the guess that whatever it holds is safe.
//
// What is deliberately NOT in the file: the shared job corpus (deployment reference
// data), provider keys and ATS/relay/scheduler settings (deployment secrets), the
// prompt cache and runner state, and the six singleton config tables that carry no
// org_id — see ORG_CONFIG_NOT_PORTABLE, echoed into the payload's `notPortable` so
// the reason travels with the file.
//
// SECURITY: this exports FULL PII (candidates, contacts, transcripts) for the whole
// org, so it is gated twice — a valid non-demo session, AND org:manage.
export async function GET() {
  // 401 for unauthenticated and for the anonymous demo session (which the proxy
  // would otherwise accept).
  const denied = await requireOperator();
  if (denied) return denied;
  // 403 for a signed-in member who is not an org administrator. Backing up the
  // organization is an owner/admin act, not something a recruiter does — and this
  // is the check that makes the export safe under multi-workspace, because it is
  // resolved org-wide from live memberships rather than from the session's team.
  const underPrivileged = await requireOrgCapability("org:manage");
  if (underPrivileged) return underPrivileged;
  try {
    const orgId = (await currentUser()).orgId ?? DEFAULT_ORG_ID;
    const payload = dumpOrg(orgId);
    const stamp = payload.createdAt.replace(/[:.]/g, "-");
    // The org id reaches a Content-Disposition header, so keep it to a filename-safe
    // subset rather than trusting it to be one.
    const slug = orgId.replace(/[^A-Za-z0-9_-]/g, "") || "org";
    return new NextResponse(JSON.stringify(payload), {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="kp-org-${slug}-${stamp}.json"`,
      },
    });
  } catch (error) {
    console.error("[api/workspace/export] dump failed", error);
    const message = error instanceof Error ? error.message : "Failed to export the organization.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
