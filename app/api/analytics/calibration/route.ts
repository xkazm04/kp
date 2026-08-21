import { NextResponse } from "next/server";
import { calibrationPairs } from "@/app/_lib/db/analyses";
import { pipelineCalibrationPairs } from "@/app/_lib/db/pipeline";
import { heldOutEntryIds } from "@/app/_lib/decision-record-store";
import { asCalibrationOutcome, computeCalibration, computeCalibrationCohorts, recommendScreeningThreshold, calibrationLeakage, type CalibrationOutcomeAxis, type CalibrationSource } from "@/app/_lib/calibration";
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
//
// UAT KAT-L1-003 — and ?outcome=advance|hired picks WHAT COUNTS AS SUCCESS, the
// second axis of the same instrument. `advance` is the historical label (past the
// screen gate, i.e. interview/offer/hired collapsed into one); `hired` is "reached
// the terminal stage", which needs only stage data and no performance rating. The
// response echoes `outcome` for the same reason it echoes `measures`.
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const roleFamily = params.get("roleFamily");
    const rawSource = params.get("source");
    // holdout = the calibration CLEAN ARM (UAT KAT-L1-001): only candidates the
    // screening wave SPARED from auto-rejection, whose outcome the score therefore did
    // not mechanically produce. It is the one source whose curve is not circular.
    const source: CalibrationSource = rawSource === "analysis" ? "analysis" : rawSource === "holdout" ? "holdout" : "pipeline";
    // ?outcome (UAT KAT-L1-003) — WHICH question the curve answers: "advance"
    // (default, the historical behaviour: 1 = past the screen gate) or "hired"
    // (1 = reached the terminal stage). The analysis producer pairs a recruiter
    // DISPOSITION and carries no pipeline stage at all, so it can only ever answer
    // the advance question; asking it for the hire axis falls back rather than
    // returning an advance curve under a hire label. The response ECHOES the axis
    // actually applied, so a fallback can never be mislabelled on screen.
    const outcome: CalibrationOutcomeAxis =
      source === "analysis" ? "advance" : asCalibrationOutcome(params.get("outcome"));
    // P1 — both producers are per-team reliability metrics: scope BOTH to the
    // caller's workspace (the pipeline branch previously defaulted, leaking the
    // default workspace's calibration curve to every team).
    const ws = await currentWorkspace();
    const family = roleFamily || null;
    // The outcome axis rides in the SOURCE slot of the key (a `source:outcome`
    // composite): both vocabularies are closed and colon-free, so the compound is
    // collision-free, and no advance payload can ever be served for a hire request.
    const payload = calibrationCache.get(calibrationCacheKey(ws, `${source}:${outcome}`, family), () => {
      const allPairs =
        source === "analysis"
          ? calibrationPairs(ws)
          : source === "holdout"
            ? pipelineCalibrationPairs(ws, { onlyEntryIds: heldOutEntryIds(ws), outcome })
            : pipelineCalibrationPairs(ws, { outcome });
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
      // Is the floor above actually ACTING? `currentThreshold` is a plain number that falls
      // back to SCREENING_DEFAULT.maxMatchToReject = 45, but the shipped default for
      // `autoRejectEnabled` is FALSE — the wave returns `autoRejectOff` and rejects nobody
      // (screen-wave.ts). Shipping the floor without the flag let every surface that reads
      // it narrate a gate that does not exist: a coral floor marker on the reliability
      // diagram, "every family is screened at the global 45", and an Apply button. The rule
      // is already read here for the floor; the flag rides beside it so a reader can never
      // be handed the number without the switch. `null` (not `false`) on the non-pipeline
      // sources, exactly like `currentThreshold` — those arms carry no screening rule at all.
      let autoRejectEnabled: boolean | null = null;
      let familyFloors: Record<string, number> = {};
      if (source === "pipeline") {
        const screening = getDecisionConfig<ScreeningRule>("screening", ws);
        autoRejectEnabled = screening.autoRejectEnabled === true;
        // family-floors: the recommendation is measured against the EFFECTIVE floor
        // for THIS view — the selected family's override (else global), or the global
        // floor on the all-families view. So a family-scoped suggestion targets the
        // family's own floor (and is now appliable), not the global knob.
        currentThreshold = effectiveFloor(screening, family);
        // KAT-L1-003 — the recommendation is about the SCREENING auto-reject floor,
        // and it reads "how often did this band advance past screening". On the hire
        // axis that arithmetic would silently become "how often did this band get
        // hired", which is a different (and far thinner) basis for moving a screening
        // gate. So the suggestion is derived on the advance axis only, and the panel
        // says so instead of showing an absence that looks like "no evidence".
        // RATCHET GUARD — the below-floor half of the comparison must come from the
        // CLEAN ARM (the entries the wave spared), because in the contaminated arm
        // every below-floor pair is a reject the score itself produced, so only
        // "raise" is reachable. Same family scope as the displayed curve; no holdout
        // (disabled, or too few spared outcomes) → no recommendation at all.
        const allHoldout =
          outcome === "advance" ? pipelineCalibrationPairs(ws, { onlyEntryIds: heldOutEntryIds(ws), outcome: "advance" }) : [];
        const holdoutPairs = family ? allHoldout.filter((p) => p.roleFamily === family) : allHoldout;
        recommendation =
          outcome === "advance" ? recommendScreeningThreshold(pairs, holdoutPairs, currentThreshold) : null;
        // Surface which families carry an override so the panel can chip them.
        familyFloors = screening.familyFloors ?? {};
      }
      // leakage (UAT KAT-L1-001): state, in the payload, how this source's outcome
      // label is produced — so the panel can never present a circular curve as
      // accuracy. `pipeline` is score-caused (high leakage); `holdout` is the clean
      // arm (low). The recommendation above rests on the pipeline curve, so its own
      // leakage rides here too, pointing the reader at the holdout arm to trust.
      return {
        ...computeCalibration(pairs),
        families,
        measures: source,
        // The axis actually applied (see the fallback above), so the panel labels the
        // curve it got rather than the one it asked for.
        outcome,
        leakage: calibrationLeakage(source, outcome),
        cohorts,
        recommendation,
        currentThreshold,
        // Whether the floor beside it is enforced (see the note above): a reader that
        // renders `currentThreshold` must be able to say "…and it is currently off".
        autoRejectEnabled,
        familyFloors,
      };
    });
    return NextResponse.json(payload);
  } catch (error) {
    // Both pair producers read whole tables, so a transient DB fault (locked
    // mid-write, corrupt file, migration race) surfaces here. Match the sibling
    // analytics routes: log with context + structured 500, never a bare crash.
    return jsonError(error, "Failed to compute calibration.");
  }
}
