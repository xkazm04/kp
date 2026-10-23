import { NextRequest, NextResponse } from "next/server";
import { RoleRunGateNotParkedError, type GateDecision } from "@/app/_lib/role-run-engine";
import { ScreenWaveApprovalError, isRoleRunGate } from "@/app/_lib/role-run-gates";
import { commitRoleRunStageGateAndContinue } from "@/app/_lib/role-run-commit-continue";
import { resolveRoleRunGateSubject } from "@/app/_lib/role-run-gate-preview";
import { SCREEN_WAVE_APPROVAL_CODES } from "@/app/_lib/screen-wave-refusal-codes";
import { getRoleRun } from "@/app/_lib/db/role-runs";
import { withWorkspace } from "@/app/_lib/auth/workspace-context";
import { isNamedApprover, resolveApprover } from "@/app/_lib/auth/operator-approver";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { requireCapability } from "@/app/_lib/auth/current-user";
import { jsonRefusal, requireCapabilityCoded, safeJsonError } from "@/app/_lib/api-response";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";

// POST /api/role-runs/[id]/gate/commit — ADR-0011 §3. A human resolves one parked
// candidate branch at one of the three gates, carrying the token the preview issued.
//
// THE APPROVER IS SERVER-BOUND: resolveApprover() names the signed-in person, and any
// client-supplied approver is ignored (the screen-wave rule). An approver who is only
// the posture placeholder is passed as null, so the commit is refused "unattributed"
// rather than recorded as an unsigned act.
//
// The subject set is re-derived from the parked artifact, never taken from the body, so
// a branch whose parked artifact changed since the preview is refused "mismatch".
// Ledger-only: this commit mints no invite or offer on the board (ADR 0011, 2026-10-07
// amendment). It does continue the run: one live pass follows a successful commit, so
// nobody has to re-trigger; a refused commit takes no pass.

// Same key and budget as ../preview: a commit is always preceded by a preview.
const GATE_RATE_LIMIT = { limit: 120, windowMs: 10 * 60_000 };

export const POST = withWorkspace(async (ws: string, request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const denied = await requireOperator();
  if (denied) return denied;
  const under = await requireCapabilityCoded("pipeline:write", requireCapability);
  if (under) return under;
  try {
    const { id } = await params;
    const body = (await request.json().catch(() => null)) as {
      gate?: unknown;
      branchRef?: unknown;
      decision?: unknown;
      approvalToken?: unknown;
    } | null;
    const branchRef = typeof body?.branchRef === "string" ? body.branchRef.trim() : "";
    const decision = body?.decision;
    if (!isRoleRunGate(body?.gate) || !branchRef || (decision !== "approved" && decision !== "declined")) {
      return jsonRefusal("ROLE_RUN_GATE_INVALID", 400);
    }
    if (!getRoleRun(id, ws)) return jsonRefusal("ROLE_RUN_NOT_FOUND", 404);
    if (!rateLimit(`role-run-gate:${clientIpFrom(request.headers)}`, GATE_RATE_LIMIT)) {
      return jsonRefusal("TOO_MANY_REQUESTS", 429);
    }
    const subject = resolveRoleRunGateSubject(id, body.gate, branchRef, ws);
    const token = typeof body.approvalToken === "string" ? body.approvalToken.trim() : "";
    const approver = await resolveApprover();
    const { status, pass } = await commitRoleRunStageGateAndContinue(
      {
        runId: id,
        branchRef,
        gate: body.gate,
        decision: decision as GateDecision,
        policyVersion: subject.policyVersion,
        subjectRefs: subject.subjectRefs,
        token,
        approver: isNamedApprover(approver) ? approver : null,
      },
      ws
    );
    return NextResponse.json({
      runId: id,
      gate: body.gate,
      branchRef,
      decision,
      status,
      continued: pass.outcome,
      awaiting: pass.outcome === "advanced" ? pass.awaiting : [],
    });
  } catch (error) {
    // The five approval refusals ask the recruiter for five different things; the
    // machine-readable `reason` rides beside the registered code so a client can branch.
    if (error instanceof ScreenWaveApprovalError) {
      return jsonRefusal(SCREEN_WAVE_APPROVAL_CODES[error.reason], 409, { reason: error.reason });
    }
    if (error instanceof RoleRunGateNotParkedError) return jsonRefusal("ROLE_RUN_GATE_NOT_PARKED", 409);
    return safeJsonError(error, "api:role-runs/gate/commit", "ROLE_RUN_GATE_FAILED");
  }
});
