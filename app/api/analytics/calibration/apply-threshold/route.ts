import { NextResponse } from "next/server";
import { pipelineCalibrationPairs } from "@/app/_lib/db/pipeline";
import { jsonRefusal, safeJsonError } from "@/app/_lib/api-response";
import { can } from "@/app/_lib/auth/current-user";
import { recommendScreeningThreshold } from "@/app/_lib/calibration";
import { getDecisionConfig, updateDecisionConfig, type ScreeningRule } from "@/app/_lib/decision-config-store";
import { effectiveFloor } from "@/app/_lib/decision-config-schema";
import { ROLE_FAMILY_SLUGS } from "@/app/_lib/role-families";
import { sealDecisionSafe, heldOutEntryIds } from "@/app/_lib/decision-record-store";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { humanActor, resolveApprover } from "@/app/_lib/auth/operator-approver";


// Direction 3 — "calibration that recommends, not just reports". Apply the
// display-only threshold suggestion with ONE explicit human click. It does NOT
// fork a write path: it re-derives the SAME recommendation the panel showed,
// refuses to apply anything that isn't the live recommendation (a stale/forged
// value → 409), then writes through updateDecisionConfig — the same validated,
// clamped, dual-tier store DecisionRulesModal writes through, so the change is
// trivially reversible the same way, but transactional so two concurrent applies
// cannot clobber each other's family floors. Every apply seals a tamper-evident
// decision record.
//
// Operator-gated like /api/decisions/config (these rules drive the auto-reject
// wave), and re-derived server-side so the applied value can only ever be one the
// live pairs actually defend.
//
// AUTHORITY (2026-09-03). The operator gate is "a valid, non-demo session" — it reads
// no ROLE — so every seat on the team, `viewer` included, could move the live
// auto-reject floor. The floor decides who the screening wave rejects without a human,
// so the write now additionally requires `pipeline:write`: the capability that already
// gates the rest of the recruiter's decision surface (moves, decisions, comms). A
// viewer is refused with a CODE, not the bare "Forbidden" the shared gate returns, so
// the panel can say why in the reader's language.
export async function POST(request: Request) {
  const denied = await requireOperator();
  if (denied) return denied;
  if (!(await can("pipeline:write"))) return jsonRefusal("ANALYTICS_POLICY_FORBIDDEN", 403);
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
        return jsonRefusal("CALIBRATION_FAMILY_UNKNOWN", 400);
      }
      roleFamily = body.roleFamily;
    }

    // CONSENT IS REQUIRED, not optional. The posted number is the one the operator
    // read on the card; the staleness comparison below is what stops a card that has
    // been open across a data change from moving the live floor to something nobody
    // approved. It used to be written `if (typeof body.suggestedThreshold === "number")`
    // — so a POST that simply omitted the field skipped the comparison and applied
    // whatever the live recommendation had become. Refuse before ANY derivation: this
    // is the cheapest refusal on the route and it must cost no calibration scan.
    if (typeof body.suggestedThreshold !== "number" || !Number.isFinite(body.suggestedThreshold)) {
      return jsonRefusal("CALIBRATION_SUGGESTION_REQUIRED", 400);
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
    // RATCHET GUARD — derived EXACTLY as the display route derives it (same clean-arm
    // below-floor band, same family scope), so the applied value can never differ from
    // the one the panel showed. Without the holdout arm the below-floor band is all
    // score-caused rejects and "raise" is the only reachable answer; no clean arm here
    // therefore means no recommendation, not a contaminated one.
    const allHoldout = pipelineCalibrationPairs(ws, { onlyEntryIds: heldOutEntryIds(ws), outcome: "advance" });
    const holdoutPairs = roleFamily ? allHoldout.filter((p) => p.roleFamily === roleFamily) : allHoldout;
    const rec = recommendScreeningThreshold(pairs, holdoutPairs, currentThreshold);
    if (!rec) {
      return jsonRefusal("CALIBRATION_RECOMMENDATION_ABSENT", 409);
    }
    // Guard against applying a stale suggestion the recruiter saw before the data
    // moved: the posted value must still match the current recommendation. The live
    // recommendation rides beside the code as DATA so the panel can re-render the
    // card from it rather than paint the server's English sentence.
    if (body.suggestedThreshold !== rec.suggestedThreshold) {
      return jsonRefusal("CALIBRATION_RECOMMENDATION_CHANGED", 409, { recommendation: rec });
    }

    // Write through a TRANSACTIONAL read-modify-write (team override), leaving every
    // other screening field untouched. A family-scoped apply sets ONLY that family's
    // entry in familyFloors (merged over any existing map); a global apply moves the
    // global maxMatchToReject. Reversible either way from this endpoint.
    //
    // The mutation runs against a re-read inside an IMMEDIATE transaction, NOT against
    // the `screening` snapshot taken at the top of this handler (scan-sweep 2026-08-22).
    // Between that read and this write sit two full-table calibration scans plus a
    // holdout read, and two applies for two DIFFERENT role families that interleave
    // across that window each merged onto the same stale map — so the first family's
    // freshly-applied auto-reject floor was silently dropped while BOTH applies sealed
    // a record saying they succeeded. setDecisionConfig's familyFloors backstop cannot
    // catch it: that only fires when the written config OMITS the key, and a family
    // apply always includes it. `currentThreshold` above stays the value the
    // recommendation was derived against and the value the operator approved, which is
    // what previousThreshold must report.
    updateDecisionConfig<ScreeningRule>(
      "screening",
      (current) =>
        roleFamily
          ? { ...current, familyFloors: { ...(current.familyFloors ?? {}), [roleFamily]: rec.suggestedThreshold } }
          : { ...current, maxMatchToReject: rec.suggestedThreshold },
      ws,
      "team"
    );

    // Seal a tamper-evident record of the policy change (best-effort — a seal
    // failure must never fail the write). No candidate subject: the ref names the
    // policy (and, when scoped, the family) so the sealed-records panel shows it as a
    // policy decision, and the rationale + inputs carry the auditable basis + family.
    // Name the natural person behind THIS request when the session carries identity
    // (the sibling screen-wave route already does): a change to the live auto-reject
    // floor must not be sealed to a role or an env constant.
    const approvedBy = await resolveApprover();
    const actor = await humanActor();
    const scopeLabel = roleFamily ? ` for role family "${roleFamily}"` : "";
    sealDecisionSafe(
      {
        kind: "screening_threshold_adjusted",
        actor,
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
    // The transactional config write and the seal both sit over the store's own SQLite
    // connection: a constraint string or the absolute db path was reaching the panel.
    return safeJsonError(error, "api:analytics/calibration/apply-threshold", "CALIBRATION_APPLY_FAILED");
  }
}
