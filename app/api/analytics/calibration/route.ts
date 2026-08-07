import { NextResponse } from "next/server";
import { calibrationPairs } from "@/app/_lib/db/analyses";
import { pipelineCalibrationPairs } from "@/app/_lib/db/pipeline";
import { heldOutEntryIds } from "@/app/_lib/decision-record-store";
import { computeCalibration, computeCalibrationCohorts, recommendScreeningThreshold, calibrationLeakage, type CalibrationSource } from "@/app/_lib/calibration";
import { getDecisionConfig, type ScreeningRule } from "@/app/_lib/decision-config-store";
import { effectiveFloor } from "@/app/_lib/decision-config-schema";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { jsonError } from "@/app/_lib/api-response";
import { createTtlCache, calibrationCacheKey } from "@/app/_lib/analytics-cache";


// Short-TTL per-(workspace, source, family) memo. WITHOUT it every panel mount and
// every source/family switch re-runs the full pair-table scan PLUS three compute
// passes (computeCalibration + computeCalibrationCohorts + recommendScreeningThreshold).
// Module-scoped so it persists across requests; keyed so no payload crosses tenants,
// sources, or families. Short TTL (see analytics-cache.ts) → no write-path invalidation.
// NOTE: this is the READ path only — the /apply-threshold WRITE guard re-derives its
// recommendation live from the DB and is deliberately NOT routed through this memo.
const calibrationCache = createTtlCache<Record<string, unknown>>();

// Calibration Engine (moonshot A/C, foundational primitive P1) — the MEASURED
// reliability of a fit score, binned into a reliability curve + Brier score +
// an honest "calibrated since N outcomes" gate. ?roleFamily filters to one
// family. Read-only.
//
// REC-02 — calibration measures the number that ACTS. Two labeled producers:
//   ?source=pipeline (default) — `pipeline_entries.match_score` × whether the
//     candidate advanced past the screen gate or was rejected there. This is
//     the score screening auto-decisions threshold (see pipelineCalibrationPairs
//     and the producer map in app/_lib/match-score.ts).
//   ?source=analysis — the saved CV-analysis score × the recruiter's
//     advance/pass disposition on the analysis (the original pairing; it never
//     gates pipeline decisions, so it is opt-in and labeled).
// The response echoes `measures` so the panel can state which score the curve
// is about instead of an undifferentiated "fit score".
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const roleFamily = params.get("roleFamily");
    const rawSource = params.get("source");
    // holdout = the calibration CLEAN ARM (UAT KAT-L1-001): only candidates the
    // screening wave SPARED from auto-rejection, whose outcome the score therefore did
    // not mechanically produce. It is the one source whose curve is not circular.
    const source: CalibrationSource = rawSource === "analysis" ? "analysis" : rawSource === "holdout" ? "holdout" : "pipeline";
    // P1 — both producers are per-team reliability metrics: scope BOTH to the
    // caller's workspace (the pipeline branch previously defaulted, leaking the
    // default workspace's calibration curve to every team).
    const ws = await currentWorkspace();
    const family = roleFamily || null;
    const payload = calibrationCache.get(calibrationCacheKey(ws, source, family), () => {
      const allPairs =
        source === "analysis"
          ? calibrationPairs(ws)
          : source === "holdout"
            ? pipelineCalibrationPairs(ws, { onlyEntryIds: heldOutEntryIds(ws) })
            : pipelineCalibrationPairs(ws);
      // The distinct families present (from the UNFILTERED set) so the UI can offer a
      // data-driven "how accurate are you for <family> roles?" selector — stable
      // regardless of which family is currently selected.
      const families = [...new Set(allPairs.map((p) => p.roleFamily).filter((f): f is string => Boolean(f)))].sort();
      const pairs = family ? allPairs.filter((p) => p.roleFamily === family) : allPairs;
      // Direction 1 — the same pairs bucketed into calendar-quarter drift cohorts,
      // each honesty-gated exactly like the headline curve.
      const cohorts = computeCalibrationCohorts(pairs);
      // Direction 3 — a display-only threshold suggestion, ONLY for the pipeline
      // (acting-score) source: the recommendation is about the screening auto-reject
      // floor (maxMatchToReject), which acts on pipeline_entries.match_score. The
      // CV-analysis score never gates pipeline decisions, so it carries no advice.
      // (Display-only — the actual write lives in /apply-threshold, which is uncached.)
      let recommendation = null;
      let currentThreshold: number | null = null;
      let familyFloors: Record<string, number> = {};
      if (source === "pipeline") {
        const screening = getDecisionConfig<ScreeningRule>("screening", ws);
        // family-floors: the recommendation is measured against the EFFECTIVE floor
        // for THIS view — the selected family's override (else global), or the global
        // floor on the all-families view. So a family-scoped suggestion targets the
        // family's own floor (and is now appliable), not the global knob.
        currentThreshold = effectiveFloor(screening, family);
        recommendation = recommendScreeningThreshold(pairs, currentThreshold);
        // Surface which families carry an override so the panel can chip them.
        familyFloors = screening.familyFloors ?? {};
      }
      // leakage (UAT KAT-L1-001): state, in the payload, how this source's outcome
      // label is produced — so the panel can never present a circular curve as
      // accuracy. `pipeline` is score-caused (high leakage); `holdout` is the clean
      // arm (low). The recommendation above rests on the pipeline curve, so its own
      // leakage rides here too, pointing the reader at the holdout arm to trust.
      return { ...computeCalibration(pairs), families, measures: source, leakage: calibrationLeakage(source), cohorts, recommendation, currentThreshold, familyFloors };
    });
    return NextResponse.json(payload);
  } catch (error) {
    // Both pair producers read whole tables, so a transient DB fault (locked
    // mid-write, corrupt file, migration race) surfaces here. Match the sibling
    // analytics routes: log with context + structured 500, never a bare crash.
    return jsonError(error, "Failed to compute calibration.");
  }
}
