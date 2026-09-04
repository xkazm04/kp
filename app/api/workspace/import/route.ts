import { NextRequest, NextResponse } from "next/server";
import { coerceOrgDumpPayload, planOrgRestore, PortabilityError, restoreOrg } from "@/app/_lib/db-portability";
import { jsonRefusal, safeJsonError } from "@/app/_lib/api-response";
import { readTextWithLimit } from "@/app/_lib/request-body";
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
//
// AND BOUNDED. `request.json()` had no budget: the whole file is parsed into the Node
// heap before anything looks at it, so an authorized administrator (or a script holding
// their session) could stream an arbitrary number of gigabytes in and OOM the server
// every other route shares — a self-inflicted outage from a button labelled "restore".
// 32 MB is an order of magnitude above a realistic org dump (a few thousand candidates
// with transcripts serializes to single-digit MB) and far below what threatens the
// process. Content-length is an advisory fast-reject; the real cap counts bytes actually
// read off the wire, the same contract the public machine endpoints use
// (billing/webhook, agents/report/[token]).
const MAX_IMPORT_BODY_BYTES = 32 * 1024 * 1024;

export async function POST(request: NextRequest) {
  const denied = await requireOperator();
  if (denied) return denied;
  const underPrivileged = await requireOrgCapability("org:manage");
  if (underPrivileged) return underPrivileged;
  try {
    const orgId = (await currentUser()).orgId ?? DEFAULT_ORG_ID;
    if (Number(request.headers.get("content-length") ?? 0) > MAX_IMPORT_BODY_BYTES) {
      return jsonRefusal("IMPORT_BODY_TOO_LARGE", 413, { maxBytes: MAX_IMPORT_BODY_BYTES });
    }
    const raw = await readTextWithLimit(request, MAX_IMPORT_BODY_BYTES);
    if (raw === null) return jsonRefusal("IMPORT_BODY_TOO_LARGE", 413, { maxBytes: MAX_IMPORT_BODY_BYTES });
    type RestoreBody = { dump?: unknown; apply?: boolean; replace?: boolean };
    let body: RestoreBody | null = null;
    try {
      body = JSON.parse(raw) as RestoreBody | null;
    } catch {
      // Not JSON at all — the same operator mistake as an absent `dump` (they picked
      // the wrong file), so it gets the same coded answer rather than a parser message.
      body = null;
    }
    if (!body || typeof body !== "object" || body.dump == null) {
      return jsonRefusal("IMPORT_DUMP_REQUIRED", 400);
    }
    const coerced = coerceOrgDumpPayload(body.dump);
    // `reason` names the offending table or the expected format/version — operator
    // detail, carried as DATA so the console can show it while the surface renders the
    // localized sentence.
    if (!coerced.ok) return jsonRefusal("IMPORT_DUMP_MALFORMED", 400, { detail: coerced.reason });
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
    // A DECISION the engine made (a foreign file, a scope another org now owns, an
    // unsafe identifier) carries its own code and status — answer it as the refusal it
    // is, in the reader's language. Anything else is an accident (better-sqlite3, fs)
    // whose message names tables and the absolute db path, and goes behind the generic
    // 500 with its raw text in the server log only.
    if (error instanceof PortabilityError) return jsonRefusal(error.code, error.status);
    return safeJsonError(error, "api:workspace/import", "WORKSPACE_RESTORE_FAILED");
  }
}
