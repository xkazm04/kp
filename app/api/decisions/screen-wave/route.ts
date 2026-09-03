import { NextRequest, NextResponse } from "next/server";
import { runScreenWave, ScreenWaveApprovalError } from "@/app/_lib/screen-wave";
import { DecisionConfigError, validateScreeningOverride } from "@/app/_lib/decision-config-schema";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { resolveApprover } from "@/app/_lib/auth/operator-approver";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { jsonRefusal } from "@/app/_lib/api-response";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";

export const maxDuration = 60;

// The heaviest door in the Decisions tab and the only one that was unthrottled: a
// commit rejects real candidates, seals a record each and QUEUES THEIR ADVERSE-ACTION
// EMAIL, and the dry-run preview runs the same cohort ranking (a full scored read per
// hit) — the sibling write doors /api/pipeline/batch and /api/decisions/config both
// self-limit, this one did not. The operator gate above is a documented no-op in open
// mode (KP_OPERATOR_PASSWORD unset), so the limiter is the real bound. One budget for
// preview AND commit on purpose: the preview is the expensive half and a commit is
// always preceded by one. 60/10min per IP sits far above a recruiter tuning the
// sliders (the preview is debounced at 350ms) and pins a scripted loop at 6/min.
const WAVE_RATE_LIMIT = { limit: 60, windowMs: 10 * 60_000 };

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
    // Placed after every cheap refusal (missing jobId, malformed override) so a request
    // that was never going to run a wave costs no budget, and before runScreenWave —
    // the cohort read, the commits, the seals and the comms.
    if (!rateLimit(`screen-wave:${clientIpFrom(request.headers)}`, WAVE_RATE_LIMIT)) {
      return jsonRefusal("TOO_MANY_REQUESTS", 429);
    }
    // Human-approval gate (Art. 22): a commit must carry the approval token the
    // recruiter reviewed in the preview. Missing / no longer matching the live set /
    // older than SCREEN_WAVE_APPROVAL_MAX_AGE_MS (the token carries its own issue
    // time) → runScreenWave throws ScreenWaveApprovalError (→ 409 below), and the
    // client re-previews. A dry run needs no approval.
    // Only build an approval when a token is actually supplied — so a commit with no
    // token at all gets the "approval required" message, while a present-but-stale
    // token gets the "set changed, re-preview" message. Both are refused (409).
    const approvalToken = typeof body.approvalToken === "string" ? body.approvalToken.trim() : "";
    // Art. 22 approver (finding SD-2): the "who reviewed this automated adverse decision"
    // field is the most legally load-bearing part of the sealed record, so it must be an
    // AUTHENTICATED fact, not a client assertion. This handler is already operator-gated
    // (requireOperator above), so we bind the approver to the server-derived identity and
    // IGNORE any body.approvedBy — a caller can no longer attribute the human review to
    // an arbitrary name.
    //
    // UAT LUC-ANA-4 / gap G5 — this used to be operatorApprover() with a comment saying
    // per-user identity did not exist yet. It does (E0 shipped: currentUserId + the users
    // table), and the comment had gone stale while the most legally load-bearing field in
    // the record still read "operator (single-operator deployment)". resolveApprover()
    // now names the signed-in person when the session carries identity and falls back to
    // that posture string only when it genuinely doesn't — an open/keyless deployment has
    // no named user, and inventing one would be the same overclaim (guardrail G3).
    const approval =
      dryRun || !approvalToken
        ? undefined
        : {
            token: approvalToken,
            approvedBy: await resolveApprover(),
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
