import { NextRequest, NextResponse } from "next/server";
import { coerceDumpPayload, loadWorkspace, planImport } from "@/app/_lib/db-portability";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { multiWorkspaceEnabled } from "@/app/_lib/workspace-lock";


// DATA3 — restore a kp-db-dump file into the live workspace. Two-step by
// design: the default call is a DRY RUN returning the plan (per-table row
// counts + which live tables already hold rows); only an explicit
// { apply: true, replace: <populated.length > 0> } performs the load, which
// keeps db-load.mjs's all-or-nothing transaction and refuse-to-clobber
// semantics (a populated table is never touched without `replace`).
//
// SCOPE NOTE (tri-scan #2): this restores the WHOLE DATABASE, not one workspace —
// loadWorkspace drops+recreates+reloads every table in the dump. Safe today only
// under the single-tenant lock (workspace-lock.ts); before KP_MULTI_WORKSPACE is
// enabled it MUST be reworked to restore into the active workspace's rows only
// (per-table delete-by-workspace + insert, never DROP TABLE), or one tenant's
// import clobbers all the others.
//
// SECURITY NOTE: restoring executes the dump's DDL and replaces data wholesale —
// strictly an operator action, behind the proxy auth gate (active when
// KP_OPERATOR_PASSWORD is set); see auth-sessions-tenancy.md #3.
export async function POST(request: NextRequest) {
  // Defense-in-depth beyond the proxy session gate: restoring executes the dump's
  // DDL and replaces data wholesale (DROP TABLE per table), so it must be
  // operator-only. requireOperator() also rejects the anonymous demo session.
  const denied = await requireOperator();
  if (denied) return denied;
  // Hard mode-guard (backlog #15, enforcing the SCOPE NOTE above): this endpoint
  // restores the WHOLE database — loadWorkspace DROPs and reloads every table —
  // which is only safe under the single-tenant lock. In multi-workspace mode one
  // tenant's import would clobber every other tenant wholesale, so refuse
  // outright BEFORE reading the body (the dry-run and the apply alike). The
  // endpoint must be reworked to a per-workspace restore (delete-by-workspace +
  // insert, never DROP TABLE) before this guard may be lifted.
  if (multiWorkspaceEnabled()) {
    return NextResponse.json(
      {
        error:
          "Whole-database import is disabled in multi-workspace mode: it would drop and replace every workspace's data. Unset KP_MULTI_WORKSPACE for a single-tenant restore, or wait for per-workspace import.",
      },
      { status: 503 }
    );
  }
  try {
    const body = (await request.json().catch(() => null)) as {
      dump?: unknown;
      apply?: boolean;
      replace?: boolean;
    } | null;
    if (!body || body.dump == null) {
      return NextResponse.json({ error: "Send { dump } — the kp-db-dump file's JSON content." }, { status: 400 });
    }
    const coerced = coerceDumpPayload(body.dump);
    if (!coerced.ok) {
      return NextResponse.json({ error: coerced.reason }, { status: 400 });
    }
    if (!body.apply) {
      return NextResponse.json({ plan: planImport(coerced.payload) });
    }
    const plan = planImport(coerced.payload);
    if (plan.populated.length > 0 && !body.replace) {
      return NextResponse.json(
        { error: "These tables already contain rows — confirm replace to drop and restore them.", populated: plan.populated },
        { status: 409 }
      );
    }
    const summary = loadWorkspace(coerced.payload, { replace: Boolean(body.replace) });
    return NextResponse.json({ loaded: summary });
  } catch (error) {
    console.error("[api/workspace/import] load failed", error);
    const message = error instanceof Error ? error.message : "Failed to restore the workspace.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
