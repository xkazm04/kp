import { NextRequest, NextResponse } from "next/server";
import { runScreenWave, ScreenWaveApprovalError } from "@/app/_lib/screen-wave";
import { DecisionConfigError, validateScreeningOverride } from "@/app/_lib/decision-config-schema";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { operatorApprover } from "@/app/_lib/auth/operator-approver";
import { requireOperator } from "@/app/_lib/auth/require-operator";

export const maxDuration = 60;

// Run the screening auto-reject wave over one role's matched cohort. An optional
// `override` rule lets the simulation/preview run it without changing the saved
// config.
// Operator-gated (backlog #30 / SD-L1-010): the wave rejects real candidates,
// queues their adverse-action emails, and seals records into THIS TEAM's per-tenant
// chain — so the handler re-verifies the operator session (rejecting the anonymous
// demo-workspace session) exactly like /api/automation/[task]. The dry-run
// preview reads the same cohort PII, so it is gated too.
export async function POST(request: NextRequest) {
  const denied = await requireOperator();
  if (denied) return denied;
  try {
    // Tenant (P1): scope the whole wave — cohort read, approval token, commits, and
    // seals — to the caller's team. Without this the wave would rank and reject the
    // DEFAULT team's Screened cohort regardless of who is signed in.
    const ws = await currentWorkspace();
    const body = (await request.json()) as {
      jobId?: string;
      override?: unknown;
      dryRun?: unknown;
      approvalToken?: unknown;
      approvedBy?: unknown;
    };
    if (!body.jobId) return NextResponse.json({ error: "jobId is required." }, { status: 400 });
    // Validate the optional per-run override at the trust boundary: auto-reject is
    // irreversible (status change + queued candidate email), so a malformed or
    // out-of-range override is a 400 here — and the clamped result, never the raw
    // body, is what reaches runScreenWave's bottom-% math (idea-1852b219).
    const checked = validateScreeningOverride(body.override);
    if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });
    // dryRun (DEC2): preview the cohort the wave WOULD reject — full math, zero
    // mutation/comms. Default false (commit), so an old client without the flag
    // behaves exactly as before; only an explicit `true` previews.
    const dryRun = body.dryRun === true;
    // Human-approval gate (Art. 22): a commit must carry the approval token the
    // recruiter reviewed in the preview. Missing/stale → runScreenWave throws
    // ScreenWaveApprovalError (→ 409 below). A dry run needs no approval.
    // Only build an approval when a token is actually supplied — so a commit with no
    // token at all gets the "approval required" message, while a present-but-stale
    // token gets the "set changed, re-preview" message. Both are refused (409).
    const approvalToken = typeof body.approvalToken === "string" ? body.approvalToken.trim() : "";
    // Art. 22 approver (finding SD-2): the "who reviewed this automated adverse decision"
    // field is the most legally load-bearing part of the sealed record, so it must be an
    // AUTHENTICATED fact, not a client assertion. This handler is already operator-gated
    // (requireOperator above), so we bind the approver to the server-derived operator
    // identity via operatorApprover() and IGNORE any body.approvedBy — a caller can no
    // longer attribute the human review to an arbitrary name. (Per-user identity doesn't
    // exist yet — single-operator deploy — so operatorApprover() is the authenticated
    // actor; when it lands, derive the specific reviewer from the session here.)
    const approval =
      dryRun || !approvalToken
        ? undefined
        : {
            token: approvalToken,
            approvedBy: operatorApprover(),
          };
    const result = await runScreenWave(body.jobId, checked.override, { dryRun, approval }, ws);
    return NextResponse.json(result);
  } catch (error) {
    // No human approval (or a token that no longer matches the live set) → 409 so
    // the client re-previews and re-approves the current set before committing.
    if (error instanceof ScreenWaveApprovalError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    // runScreenWave's backstop throws DecisionConfigError on a bad override —
    // surface it as a 400 too, so a schema violation is never reported as a 500.
    if (error instanceof DecisionConfigError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Screen wave failed." }, { status: 500 });
  }
}
