import { NextRequest, NextResponse } from "next/server";
import { jsonRefusal, requireCapabilityCoded, safeJsonError } from "@/app/_lib/api-response";
import { activePromoteFloor } from "@/app/_lib/devcase-orchestrator";
import { recordAudit, setPromoteFloor } from "@/app/_lib/dev-control";
import { calibrate, listOutcomes, outcomeInputSchema, recordOutcome } from "@/app/_lib/dev-outcomes";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { requireCapability, requireOrgCapability } from "@/app/_lib/auth/current-user";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";


const activeFloor = activePromoteFloor;

// Polled beside /api/devcase/control from every open control room (2s active / 6s idle
// per tab), and every hit re-runs calibrate() over the whole outcome corpus - so the
// ceiling sits above three tabs polling flat out and bounds a scripted read.
const OUTCOMES_READ_RATE_LIMIT = { limit: 900, windowMs: 10 * 60_000 };

// Direction E — the outcome loop: record what happened + read the calibration.
// TENANT SCOPE (D5): both are the CALLER'S workspace — the outcome corpus (and so the
// promote-floor recommendation derived from it) is per-team, not deployment-wide. The
// promote FLOOR itself stays global (dev_control is a declared deployment-level table).
export async function GET(request: NextRequest) {
  // Director gate (2026-09-03): the control room's doors carried no operator check, so a
  // demo cookie could reach them. READ stays at identity presence; the WRITES below ask
  // the capability.
  const denied = await requireOperator();
  if (denied) return denied;
  // Open mode makes the gate above a no-op for the whole API, so this limiter is the real
  // bound on a polled, unpaginated read that recomputes the calibration on every hit.
  if (!rateLimit(`devcase-outcomes-read:${clientIpFrom(request.headers)}`, OUTCOMES_READ_RATE_LIMIT)) {
    return jsonRefusal("TOO_MANY_REQUESTS", 429);
  }
  try {
    const ws = await currentWorkspace();
    return NextResponse.json({ outcomes: listOutcomes(80, ws), calibration: calibrate(activeFloor(), ws), activeFloor: activeFloor() });
  } catch (error) {
    return safeJsonError(error, "api:devcase/outcomes", "DEVCASE_OUTCOMES_FAILED");
  }
}

export async function POST(request: NextRequest) {
  // Director gate (2026-09-03): the control room's doors carried no operator check, so a
  // demo cookie could reach them. Identity presence for now; the capability slice follows.
  const denied = await requireOperator();
  if (denied) return denied;
  try {
    const body = (await request.json().catch(() => ({}))) as {
      setFloor?: number;
      ref?: string;
      candidateRef?: string;
      predictedScore?: number;
      outcome?: string;
      performance?: number;
      note?: string;
    };

    // AUTHORITY (/perfect wave 21). Two different doors behind one POST:
    //   - setFloor moves the promote threshold EVERY future auto-decision is judged
    //     against, and `promote_floor` is a global dev_control key: deployment policy,
    //     so org-level authority (`org:manage`).
    //   - recording an outcome is a recruiter operation on this team's corpus, and it
    //     feeds the floor recommendation - `pipeline:write`, never a viewer.
    if (typeof body.setFloor === "number") {
      const forbidden = await requireCapabilityCoded("org:manage", requireOrgCapability);
      if (forbidden) return forbidden;
    } else {
      const forbidden = await requireCapabilityCoded("pipeline:write", requireCapability);
      if (forbidden) return forbidden;
    }

    // Apply a calibrated threshold (human action — the loop stays human-in-the-loop).
    if (typeof body.setFloor === "number") {
      // typeof NaN/Infinity === "number" — reject non-finite before it reaches the store,
      // where it would stringify to "NaN", read back as null, and silently fall back to the
      // default floor while the audit log claims a calibration that never took effect.
      if (!Number.isFinite(body.setFloor)) {
        // A code, not prose: the panel renders errors.DEVCASE_FLOOR_INVALID in the
        // reader's language (the English sentence stays for the log and API consumers).
        return jsonRefusal("DEVCASE_FLOOR_INVALID", 400);
      }
      setPromoteFloor(body.setFloor);
      recordAudit({
        actor: "human",
        action: "set_promote_floor",
        reason: `floor → ${Math.round(body.setFloor)} (from calibration)`,
        workspaceId: await currentWorkspace(),
      });
      return NextResponse.json({ activeFloor: activeFloor() });
    }

    // Validate the outcome against the canonical vocabulary + 1..5 hired-only perf scale at
    // this boundary, so a typo'd label or stray performance score can never reach the
    // calibration store and silently bias the promote-floor suggestion.
    const parsed = outcomeInputSchema.safeParse(body);
    if (!parsed.success) {
      // The zod sentence is English and cannot be localized, so it rides as DATA
      // (`issue`, for the log and API consumers) beside a code the panel can render.
      const issue = parsed.error.issues[0]?.message ?? "Invalid outcome payload.";
      return jsonRefusal("DEVCASE_OUTCOME_INVALID", 400, { issue });
    }
    const outcome = parsed.data;
    const ws = await currentWorkspace();
    recordOutcome(outcome, ws);
    // The reason carries the CANDIDATE REF - the row the workspace stamp exists for.
    recordAudit({
      actor: "human",
      action: "outcome_recorded",
      reason: `${outcome.candidateRef ?? "candidate"}: ${outcome.outcome}${outcome.performance ? ` (perf ${outcome.performance})` : ""}`,
      workspaceId: ws,
    });
    return NextResponse.json({ ok: true, calibration: calibrate(activeFloor(), ws) });
  } catch (error) {
    // The POST records an outcome and re-runs calibration over the store.
    return safeJsonError(error, "api:devcase/outcomes", "DEVCASE_OUTCOME_SAVE_FAILED");
  }
}
