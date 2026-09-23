import { NextRequest, NextResponse } from "next/server";
import { updateDecisionConfig } from "@/app/_lib/decision-config-store";
import { DecisionConfigError, type PipelineStagesRule } from "@/app/_lib/decision-config-schema";
import { applyStageSla } from "@/app/_lib/stage-sla";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { requireCapability } from "@/app/_lib/auth/current-user";
import { getPipelineAxis } from "@/app/_lib/pipeline-axis-server";
import { jsonRefusal, safeJsonError, requireCapabilityCoded } from "@/app/_lib/api-response";

// PATCH /api/pipeline/stage-sla {stage, days | null} — set or clear ONE column's aging
// cadence for this team (challenge-r03 pipeline-board-ui/A).
//
// The cadence is team data on the workspace's `pipelineStages` axis (`slaDays`), read
// by the board, the sidebar badge and the automation pass through one aging clock
// (aging-policy.ts). It used to be per-browser localStorage, so two recruiters on one
// team aged the same board differently.
//
// A narrow route rather than a whole-axis POST from the board: the board edits one
// number, and round-tripping the whole axis from a client snapshot would clobber a
// Settings -> Hiring save that landed in between. `updateDecisionConfig` re-reads the
// effective axis INSIDE an IMMEDIATE transaction and applies the one-column edit to
// that, so the only thing this write can change is the value it names. Every write
// bumps the axis version, so a composer still holding the old axis is refused as
// stale (PIPELINE_AXIS_STALE) rather than silently erasing the cadence.
//
// Written at scope "team", like the composer's axis writes: this team's board.

/** Thrown inside the transaction to abort it with nothing written. */
class StageSlaRefusal extends Error {}

type Body = { stage?: unknown; days?: unknown };

export async function PATCH(request: NextRequest) {
  const denied = await requireOperator();
  if (denied) return denied;
  // AUTHORIZATION (write-routes-check-a-capability): requireOperator proves a trusted
  // session, never authority. A team cadence is board policy, so ask for the same
  // `pipeline:write` every other axis write asks for. This is a TIGHTEN for a seat
  // without it: before, anyone could tune their own browser's cadence.
  const under = await requireCapabilityCoded("pipeline:write", requireCapability);
  if (under) return under;
  try {
    const body = (await request.json().catch(() => null)) as Body | null;
    const stage = body?.stage;
    const days = body?.days;
    if (typeof stage !== "string" || !(days === null || typeof days === "number")) {
      return jsonRefusal("DECISION_CONFIG_INVALID", 400, { detail: "stage must be a string and days a number or null." });
    }
    const ws = await currentWorkspace();
    // The refusal's detail is captured as a VALUE here, never read back off a thrown
    // error's message (error-response-contract.test.ts): it names the field, rides as
    // DATA beside the code, and is never what the UI paints.
    let refusal: string | null = null;
    try {
      updateDecisionConfig<PipelineStagesRule>(
        "pipelineStages",
        (current) => {
          const res = applyStageSla(current, stage, days);
          if (!res.ok) {
            refusal = res.error;
            throw new StageSlaRefusal();
          }
          return res.rule as unknown as Record<string, unknown>;
        },
        ws,
        "team"
      );
    } catch (error) {
      if (error instanceof StageSlaRefusal) return jsonRefusal("DECISION_CONFIG_INVALID", 400, { detail: refusal });
      // The store's own backstop re-validates the whole axis before writing; a stored
      // axis it now refuses is a refusal too, not a 500.
      if (error instanceof DecisionConfigError) return jsonRefusal("DECISION_CONFIG_INVALID", 400);
      throw error;
    }
    return NextResponse.json({ ok: true, stages: getPipelineAxis(ws).stages });
  } catch (error) {
    return safeJsonError(error, "api:pipeline/stage-sla", "DECISION_CONFIG_SAVE_FAILED");
  }
}
