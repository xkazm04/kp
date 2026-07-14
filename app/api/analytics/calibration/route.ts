import { NextResponse } from "next/server";
import { calibrationPairs, pipelineCalibrationPairs } from "@/app/_lib/db";
import { computeCalibration, computeCalibrationCohorts, recommendScreeningThreshold } from "@/app/_lib/calibration";
import { getDecisionConfig, type ScreeningRule } from "@/app/_lib/decision-config-store";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { jsonError } from "@/app/_lib/api-response";


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
    const source = params.get("source") === "analysis" ? "analysis" : "pipeline";
    // P1 — both producers are per-team reliability metrics: scope BOTH to the
    // caller's workspace (the pipeline branch previously defaulted, leaking the
    // default workspace's calibration curve to every team).
    const ws = await currentWorkspace();
    const allPairs = source === "analysis" ? calibrationPairs(ws) : pipelineCalibrationPairs(ws);
    // The distinct families present (from the UNFILTERED set) so the UI can offer a
    // data-driven "how accurate are you for <family> roles?" selector — stable
    // regardless of which family is currently selected.
    const families = [...new Set(allPairs.map((p) => p.roleFamily).filter((f): f is string => Boolean(f)))].sort();
    const pairs = roleFamily ? allPairs.filter((p) => p.roleFamily === roleFamily) : allPairs;
    // Direction 1 — the same pairs bucketed into calendar-quarter drift cohorts,
    // each honesty-gated exactly like the headline curve.
    const cohorts = computeCalibrationCohorts(pairs);
    // Direction 3 — a display-only threshold suggestion, ONLY for the pipeline
    // (acting-score) source: the recommendation is about the screening auto-reject
    // floor (maxMatchToReject), which acts on pipeline_entries.match_score. The
    // CV-analysis score never gates pipeline decisions, so it carries no advice.
    let recommendation = null;
    let currentThreshold: number | null = null;
    if (source === "pipeline") {
      const screening = getDecisionConfig<ScreeningRule>("screening", ws);
      currentThreshold = screening.maxMatchToReject;
      recommendation = recommendScreeningThreshold(pairs, currentThreshold);
    }
    return NextResponse.json({ ...computeCalibration(pairs), families, measures: source, cohorts, recommendation, currentThreshold });
  } catch (error) {
    // Both pair producers read whole tables, so a transient DB fault (locked
    // mid-write, corrupt file, migration race) surfaces here. Match the sibling
    // analytics routes: log with context + structured 500, never a bare crash.
    return jsonError(error, "Failed to compute calibration.");
  }
}
