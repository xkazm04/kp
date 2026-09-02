import { NextRequest, NextResponse } from "next/server";
import { coerceOrgDumpPayload, planOrgRestore, restoreOrg } from "@/app/_lib/db-portability";
import { jsonRefusal } from "@/app/_lib/api-response";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { currentUser, requireOrgCapability } from "@/app/_lib/auth/current-user";
import { DEFAULT_ORG_ID } from "@/app/_lib/db/organizations";

// Restore a kp-org-dump file into THE CALLER'S OWN ORGANIZATION. Two-step by
// design: the default call is a DRY RUN returning the plan (per-table rows in the
// file vs rows the restore would clear); only an explicit { apply: true } writes,
// and when the restore would delete anything it also needs { replace: true } — so
// "12 tables" can never stand in for "and 4,000 rows are about to go".
//
// IN-PLACE, and only in place. The org is rolled back to the state the file
// describes: DELETE the org's scope, INSERT the file's rows, one transaction,
// never DROP TABLE (another org's rows live in the same tables). It is NOT a
// migration path between deployments — the ids in the file are this deployment's,
// which is precisely what makes the restore safe; see the header on the org
// backup section in db-portability.ts and the gap noted in
// docs/features/organization/README.md.
//
// This replaced a WHOLE-DATABASE restore that DROPped and recreated every table in
// the dump, and was therefore hard-refused (503) once KP_MULTI_WORKSPACE was on.
//
// SECURITY: restoring replaces the organization's data wholesale, so it is gated
// twice — a valid non-demo session, AND org:manage.
export async function POST(request: NextRequest) {
  const denied = await requireOperator();
  if (denied) return denied;
  const underPrivileged = await requireOrgCapability("org:manage");
  if (underPrivileged) return underPrivileged;
  try {
    const orgId = (await currentUser()).orgId ?? DEFAULT_ORG_ID;
    const body = (await request.json().catch(() => null)) as {
      dump?: unknown;
      apply?: boolean;
      replace?: boolean;
    } | null;
    if (!body || body.dump == null) {
      return NextResponse.json({ error: "Send { dump } — the kp-org-dump file's JSON content." }, { status: 400 });
    }
    const coerced = coerceOrgDumpPayload(body.dump);
    if (!coerced.ok) return NextResponse.json({ error: coerced.reason }, { status: 400 });
    // A backup goes back into the org it came from. Refusing here (rather than in
    // the engine alone) keeps the dry run honest too: planning a foreign file would
    // report counts for a scope this caller has no authority over.
    if (coerced.payload.orgId !== orgId) {
      // The two most instructive refusals this route has, and both were bare English
      // with no code: the console could only say "restore failed" for "you picked the
      // wrong file" and for "this will delete 4,000 rows, confirm it". Coded now, so
      // each renders its own sentence in the reader's language.
      return jsonRefusal("RESTORE_FOREIGN_ORG", 409);
    }

    const plan = planOrgRestore(coerced.payload, orgId);
    if (!body.apply) return NextResponse.json({ plan });
    if (plan.totalExisting > 0 && !body.replace) {
      // The counts ride alongside the code: the confirm dialog says WHAT is about to
      // go, in the reader's language, instead of painting the server's sentence.
      return jsonRefusal("RESTORE_REPLACE_REQUIRED", 409, {
        existingRows: plan.totalExisting,
        populated: plan.tables.filter((t) => t.existing > 0).map((t) => t.name),
      });
    }
    const summary = restoreOrg(coerced.payload, orgId);
    return NextResponse.json({ restored: summary });
  } catch (error) {
    console.error("[api/workspace/import] restore failed", error);
    const message = error instanceof Error ? error.message : "Failed to restore the organization.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
