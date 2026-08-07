import { NextResponse } from "next/server";
import { pipelineCalibrationPairs } from "@/app/_lib/db/pipeline";
import { recommendScreeningThreshold } from "@/app/_lib/calibration";
import { getDecisionConfig, setDecisionConfig, type ScreeningRule } from "@/app/_lib/decision-config-store";
import { effectiveFloor } from "@/app/_lib/decision-config-schema";
import { ROLE_FAMILY_SLUGS } from "@/app/_lib/role-families";
import { sealDecisionSafe } from "@/app/_lib/decision-record-store";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { operatorApprover } from "@/app/_lib/auth/operator-approver";


// Direction 3 — "calibration that recommends, not just reports". Apply the
// display-only threshold suggestion with ONE explicit human click. It does NOT
// fork a write path: it re-derives the SAME recommendation the panel showed,
// refuses to apply anything that isn't the live recommendation (a stale/forged
// value → 409), then writes through the EXISTING setDecisionConfig mechanism —
// the identical path DecisionRulesModal uses, so the change is trivially
// reversible the same way. Every apply seals a tamper-evident decision record.
//
// Operator-gated like /api/decisions/config (these rules drive the auto-reject
// wave), and re-derived server-side so the applied value can only ever be one the
// live pairs actually defend.
export async function POST(request: Request) {
  const denied = await requireOperator();
  if (denied) return denied;
  try {
    const ws = await currentWorkspace();
    const body = (await request.json().catch(() => ({}))) as { suggestedThreshold?: unknown; roleFamily?: unknown };

    // family-floors: an optional family scope. Present → apply THAT family's override
    // (re-derived against the SAME family's live pairs, preserving the round-8 staleness
    // honesty); absent → the global floor path, byte-identical to before. A junk family
    // is a 400 (never a silent global write nor an unbounded familyFloors key).
    let roleFamily: string | null = null;
    if (body.roleFamily !== undefined && body.roleFamily !== null && body.roleFamily !== "") {
      if (typeof body.roleFamily !== "string" || !(ROLE_FAMILY_SLUGS as readonly string[]).includes(body.roleFamily)) {
        return NextResponse.json({ error: "Unknown role family." }, { status: 400 });
      }
      roleFamily = body.roleFamily;
    }

    const screening = getDecisionConfig<ScreeningRule>("screening", ws);
    // The floor the recommendation is measured against: the family's effective floor
    // for a family-scoped apply (its override, else global), or the global floor.
    const currentThreshold = effectiveFloor(screening, roleFamily);
    // Re-derive from the live, workspace-scoped pairs — never trust the client's
    // number — filtered to the SAME family scope the panel showed, so the write can
    // only ever apply a number that family's own pairs defend. No rec → nothing to apply.
    const allPairs = pipelineCalibrationPairs(ws);
    const pairs = roleFamily ? allPairs.filter((p) => p.roleFamily === roleFamily) : allPairs;
    const rec = recommendScreeningThreshold(pairs, currentThreshold);
    if (!rec) {
      return NextResponse.json({ error: "No calibration recommendation is available to apply." }, { status: 409 });
    }
    // Guard against applying a stale suggestion the recruiter saw before the data
    // moved: the posted value must still match the current recommendation.
    if (typeof body.suggestedThreshold === "number" && body.suggestedThreshold !== rec.suggestedThreshold) {
      return NextResponse.json(
        { error: "The recommendation changed since it was shown — reload and review the current suggestion.", recommendation: rec },
        { status: 409 }
      );
    }

    // Write through the existing mechanism (team override), leaving every other
    // screening field untouched. A family-scoped apply sets ONLY that family's entry
    // in familyFloors (merged over any existing map); a global apply moves the global
    // maxMatchToReject exactly as before. Reversible either way from this endpoint.
    const next: ScreeningRule = roleFamily
      ? { ...screening, familyFloors: { ...(screening.familyFloors ?? {}), [roleFamily]: rec.suggestedThreshold } }
      : { ...screening, maxMatchToReject: rec.suggestedThreshold };
    setDecisionConfig("screening", next, ws, "team");

    // Seal a tamper-evident record of the policy change (best-effort — a seal
    // failure must never fail the write). No candidate subject: the ref names the
    // policy (and, when scoped, the family) so the sealed-records panel shows it as a
    // policy decision, and the rationale + inputs carry the auditable basis + family.
    const approvedBy = operatorApprover();
    const scopeLabel = roleFamily ? ` for role family "${roleFamily}"` : "";
    sealDecisionSafe(
      {
        kind: "screening_threshold_adjusted",
        actor: "human:operator",
        policyVersion: `calibration-reco/maxMatch${roleFamily ? `:${roleFamily}` : ""}:${currentThreshold}->${rec.suggestedThreshold}`,
        candidateRef: roleFamily ? `policy:screening:${ws}:${roleFamily}` : `policy:screening:${ws}`,
        rationale: `Screening auto-reject floor${scopeLabel} ${rec.direction === "lower" ? "lowered" : "raised"} ${currentThreshold} → ${rec.suggestedThreshold} on calibration evidence: candidates scoring ${rec.band.lo}–${rec.band.hi} advanced past screening ${rec.advanceRatePct}% of the time (n=${rec.n}, overall n=${rec.totalOutcomes}). Approved by ${approvedBy}.`,
        reasonCode: "calibrationThreshold",
        inputs: { ...rec, previousThreshold: currentThreshold, approvedBy, roleFamily },
      },
      // Explicit workspace: candidateRef is a policy string, not a pipeline entry, so
      // the store can't derive the team from it — pass the authenticated workspace so
      // this policy seal lands on THIS team's chain, not the default (Direction 1e).
      ws
    );

    return NextResponse.json({ ok: true, previousThreshold: currentThreshold, newThreshold: rec.suggestedThreshold, roleFamily });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to apply the threshold." }, { status: 500 });
  }
}
