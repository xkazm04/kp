import { NextResponse } from "next/server";
import { closeCaseIntake } from "@/app/_lib/db/devcase";
import { recordAudit } from "@/app/_lib/dev-control";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { requireCapability } from "@/app/_lib/auth/current-user";
import { jsonRefusal, requireCapabilityCoded, safeJsonError } from "@/app/_lib/api-response";
import { lifecycleOwnsIntake } from "@/app/features/tools/devcases/DevCaseDetail.publish";
// The shared by-id owner guard (sibling module - a route file may export only handlers).
import { ownedDevCase } from "../../devcase-owned-lifecycle";

// POST /api/devcase/[id]/intake {action: "stop"} - stop a case's intake by hand
// (challenge-r09 devcase-lifecycle/B).
//
// A case published from the assignment detail has no lifecycle, and the only close was
// the lifecycle's - so its apply link could never be taken down. This door closes every
// OPEN posting of the case (closeCaseIntake: an IMMEDIATE transaction that re-reads the
// case's newest lifecycle and refuses while a running one owns intake, then an UPDATE
// that re-asserts status = 'open'). It notifies nobody: stopping intake is not a
// rejection, and a running lifecycle's Close stays the door that wraps submitters up.
// The reverse is an ordinary POST /api/devcase/publish, which mints a FRESH link.
//
// AUTHORITY: identity presence, then `pipeline:write` - the same seat publish now asks,
// so the reopen half is never looser than the stop half. TENANT: a case from another
// workspace answers exactly what an unknown id answers (DEVCASE_CASE_NOT_FOUND).
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = await requireOperator();
  if (denied) return denied;
  const forbidden = await requireCapabilityCoded("pipeline:write", requireCapability);
  if (forbidden) return forbidden;
  const { id } = await context.params;
  try {
    const body = (await request.json().catch(() => ({}))) as { action?: unknown } | null;
    if (body?.action !== "stop") return jsonRefusal("DEVCASE_INTAKE_ACTION_UNKNOWN", 400);
    const devCase = ownedDevCase(id, await currentWorkspace());
    if (!devCase) return jsonRefusal("DEVCASE_CASE_NOT_FOUND", 404);

    const result = closeCaseIntake(devCase.id, devCase.workspaceId, lifecycleOwnsIntake);
    if (!result.ok) return jsonRefusal("DEVCASE_INTAKE_LIFECYCLE_OWNS", 409, { stage: result.stage });
    // One audit row per stop that closed something; a repeat (closed: 0) changed nothing
    // and writes nothing.
    if (result.closed > 0) {
      recordAudit({
        actor: "human",
        action: "intake_stopped",
        ref: devCase.id,
        workspaceId: devCase.workspaceId,
        reason: `${result.closed} open posting(s) closed by hand; no candidate was notified`,
      });
    }
    return NextResponse.json({ ok: true, closed: result.closed });
  } catch (error) {
    // better-sqlite3: the thrown message can carry SQLITE_* detail and the db path.
    return safeJsonError(error, "api:devcase/[id]/intake", "DEVCASE_INTAKE_STOP_FAILED");
  }
}
