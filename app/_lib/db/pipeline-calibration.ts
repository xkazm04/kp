// Type-only: calibration.ts is deliberately pure/import-free, so this is erased.
import type { CalibrationOutcomeAxis } from "../calibration";
import type { AdvanceConfidence, OutcomeAxis, OutcomeEntry, OutcomeEvent } from "../calibration-outcomes";
import { screeningGateIndex, stagesWithRole } from "../pipeline-stages";
import { isTerminalEntryStatus } from "../pipeline-status";
import { ensureDb } from "./core";
import { DEFAULT_WORKSPACE_ID } from "./workspaces";
import { getPipelineAxis } from "../pipeline-axis-server";
import { calibrationAdvancedStages, calibrationHiredStages } from "./pipeline-core";

// Calibration of the ACTING score (REC-02). The analytics reliability curve used
// to measure ONLY `analyses.score × recruiter disposition` — a pair nothing in
// the pipeline flow ever writes (live n=0 with a full pipeline on disk) — while
// the score that actually gates candidates (`pipeline_entries.match_score`: the
// screen-wave threshold, advance-top-N, the policy pass) was never calibrated.
// This produces (prediction, outcome) pairs from the pipeline itself:
//
//   prediction — the entry's stored match_score (the number the screen gate
//     thresholds; see the canonical producer map in app/_lib/match-score.ts).
//   outcome 1  — the entry advanced beyond the screen gate (stage Interview/
//     Offer/Hired), whatever happened later: a candidate rejected AT interview
//     or declining an offer still validated "this score advances past screening".
//   outcome 0  — closed out as `rejected` while still at Accepted/Screened
//     (recruiter or auto-reject — the adverse decision the score fed).
//   excluded   — still pending at Accepted/Screened, and the non-merit terminal
//     statuses there (declined/role_closed/rematched): not a screen verdict.
//     Unscored entries never enter (no fabricated 0 — the REC-03 policy).
//
// Tenant scope (P1): the calibration curve is a per-team reliability metric.
// `at` carries the entry's created_at so the calibration engine can bucket pairs
// into drift cohorts (Direction 1). `entryId`/`label`/`live` ride the band-drill
// producer (Direction 2) so a mis-calibrated bin can be opened to the exact
// candidates behind it — never on the aggregate pair (it would bloat every curve).
export type PipelineCalibrationPair = { score: number; outcome: 0 | 1; roleFamily: string | null; at: string };

export type CalibrationBandCandidate = {
  entryId: string;
  label: string;
  score: number;
  outcome: 0 | 1;
  roleFamily: string | null;
  // Openable in the board when the entry is still active; a rejected (outcome 0)
  // entry is terminal, so it's listed but not linked (records outlive the board).
  live: boolean;
};

export function pipelineCalibrationPairs(
  workspaceId: string = DEFAULT_WORKSPACE_ID,
  // CALIBRATION HOLDOUT (UAT KAT-L1-001). When present, restrict the pairs to this
  // set of entry ids — the calibration CLEAN ARM. The screening wave spares a small
  // random sample of would-be auto-rejects; their eventual advance/reject is a HUMAN
  // decision, not one the score mechanically produced, so a curve over just these
  // entries breaks the label leakage that makes the default (all-pairs) curve
  // circular. The inclusion rule is IDENTICAL to the contaminated curve's — the only
  // difference is which entries are eligible — so the two are directly comparable.
  //
  // `outcome` (UAT KAT-L1-003) picks WHICH question the pairs answer:
  //   "advance" (default, unchanged) — 1 = past the screen gate, 0 = rejected there.
  //   "hired"   — 1 = reached the terminal stage; 0 = rejected ANYWHERE without
  //     getting there (a reject at interview is a "not hired" the screen gate axis
  //     scores as a success). Still in the process = excluded, because the outcome
  //     genuinely is not known yet: they may still be hired. The non-merit terminal
  //     statuses stay excluded on BOTH axes for the same reason as before — a
  //     candidate who declined the offer or whose role closed is not evidence the
  //     score was wrong about them.
  opts?: { onlyEntryIds?: ReadonlySet<string>; outcome?: CalibrationOutcomeAxis }
): PipelineCalibrationPair[] {
  const db = ensureDb();
  const rows = db
    .prepare(
      `SELECT id, match_score AS score, stage, status, role_family, created_at FROM pipeline_entries
       WHERE match_score IS NOT NULL AND workspace_id = ?`
    )
    .all(workspaceId) as { id: string; score: number; stage: string; status: string; role_family: string | null; created_at: string }[];
  const only = opts?.onlyEntryIds;
  const stages = getPipelineAxis(workspaceId).stages;
  // One positive-label set per axis; everything else about the loop is identical,
  // so the two axes are computed by the same rule and stay directly comparable.
  const positive = opts?.outcome === "hired" ? calibrationHiredStages(stages) : calibrationAdvancedStages(stages);
  const pairs: PipelineCalibrationPair[] = [];
  for (const r of rows) {
    if (!Number.isFinite(r.score)) continue; // bad migration/manual edit — never NaN into the math
    if (only && !only.has(r.id)) continue; // clean-arm filter (holdout source only)
    if (positive.has(r.stage)) {
      pairs.push({ score: r.score, outcome: 1, roleFamily: r.role_family, at: r.created_at });
    } else if (r.status === "rejected") {
      pairs.push({ score: r.score, outcome: 0, roleFamily: r.role_family, at: r.created_at });
    }
  }
  return pairs;
}

// Direction 2 — the candidates behind ONE calibration score band, workspace-scoped.
// Applies the SAME inclusion rule as pipelineCalibrationPairs ON ITS `advance`
// AXIS (advanced past the screen gate = 1, rejected there = 0;
// pending/unscored/non-merit-terminal excluded) so a bin's drilldown can never
// show a candidate the curve didn't count. Score band is [loPct, hiPct); the top
// bin includes 100 (inclusiveHi).
//
// UAT KAT-L1-003 — the drilldown is advance-axis ONLY, so the panel offers it only
// on that axis rather than listing advance outcomes under a hire curve.
export function pipelineCalibrationBandCandidates(
  loPct: number,
  hiPct: number,
  inclusiveHi: boolean,
  roleFamily: string | null,
  workspaceId: string = DEFAULT_WORKSPACE_ID
): CalibrationBandCandidate[] {
  const db = ensureDb();
  const rows = db
    .prepare(
      `SELECT id, candidate_label, match_score AS score, stage, status, role_family FROM pipeline_entries
       WHERE match_score IS NOT NULL AND workspace_id = ?
         AND match_score >= ? AND (match_score < ? ${inclusiveHi ? "OR match_score = ?" : ""})
       ORDER BY match_score DESC, candidate_label ASC`
    )
    .all(...(inclusiveHi ? [workspaceId, loPct, hiPct, hiPct] : [workspaceId, loPct, hiPct])) as {
    id: string;
    candidate_label: string;
    score: number;
    stage: string;
    status: string;
    role_family: string | null;
  }[];
  const advanced = calibrationAdvancedStages(getPipelineAxis(workspaceId).stages);
  const out: CalibrationBandCandidate[] = [];
  for (const r of rows) {
    if (!Number.isFinite(r.score)) continue;
    if (roleFamily && r.role_family !== roleFamily) continue;
    let outcome: 0 | 1;
    if (advanced.has(r.stage)) outcome = 1;
    else if (r.status === "rejected") outcome = 0;
    else continue; // pending / non-merit terminal — not part of the calibration set
    out.push({
      entryId: r.id,
      label: r.candidate_label,
      score: r.score,
      outcome,
      roleFamily: r.role_family,
      live: !isTerminalEntryStatus(r.status),
    });
  }
  return out;
}

// ─── Score vs outcome inputs (calibration-outcomes.ts) ────────────────────────
// READ-ONLY, one workspace. Which writer owns each field, and whether it is an event:
//   pipeline_entries.match_score — rewritten row (scoring/rematch); read as the score
//     only, never as an outcome or an event time.
//   pipeline_events.{kind,from_stage,to_stage,actor,created_at} — append-only trail
//     (recordEvent). Rewrites are stage renames (migratePipelineStages) and erasure
//     masking of candidate_label, neither of which changes kind, author or time.
//   profiles.payload_json $.potentialScore — the scorer's blended potential, when a
//     producer stored it (0..1). Its four components are stored by NO producer:
//     transform.compute_potential returns only the blend, so they read as null.
//   decision_records.payload_json $.inputs.aiConfidence — the sealed screening
//     confidence beside an advance (pipeline-entry-action.ts), append-only chain.
export type ScoreOutcomeInputs = {
  entries: OutcomeEntry[];
  events: OutcomeEvent[];
  confidences: AdvanceConfidence[];
  axis: OutcomeAxis;
};

export function scoreOutcomeInputs(workspaceId: string = DEFAULT_WORKSPACE_ID): ScoreOutcomeInputs {
  const db = ensureDb();
  const rows = db
    .prepare(
      `SELECT e.id, e.match_score AS match, json_extract(p.payload_json, '$.potentialScore') AS potential
       FROM pipeline_entries e
       LEFT JOIN profiles p ON p.id = e.candidate_id AND p.workspace_id = e.workspace_id
       WHERE e.workspace_id = ? AND e.match_score IS NOT NULL`
    )
    .all(workspaceId) as { id: string; match: number; potential: unknown }[];
  const entries: OutcomeEntry[] = rows.map((r) => ({
    entryId: r.id,
    scores: {
      match: Number.isFinite(r.match) ? r.match : null,
      potential: typeof r.potential === "number" && Number.isFinite(r.potential) ? r.potential * 100 : null,
      potentialDepth: null,
      potentialVelocity: null,
      potentialFoundation: null,
      potentialInitiative: null,
    },
  }));
  const events = (
    db
      .prepare(
        `SELECT entry_id, kind, from_stage, to_stage, actor, created_at FROM pipeline_events
         WHERE workspace_id = ? AND entry_id IS NOT NULL AND kind != 'stage_migrated'
         ORDER BY created_at, id`
      )
      .all(workspaceId) as { entry_id: string; kind: string; from_stage: string | null; to_stage: string | null; actor: string | null; created_at: string }[]
  ).map((r) => ({ entryId: r.entry_id, kind: r.kind, fromStage: r.from_stage, toStage: r.to_stage, actor: r.actor, at: r.created_at }));
  let confidences: AdvanceConfidence[] = [];
  try {
    confidences = (
      db
        .prepare(
          `SELECT candidate_ref, kind, json_extract(payload_json, '$.inputs.aiConfidence') AS c, created_at FROM decision_records
           WHERE workspace_id = ? AND kind IN ('advanced', 'auto_advanced')`
        )
        .all(workspaceId) as { candidate_ref: string; kind: string; c: unknown; created_at: string }[]
    )
      .filter((r) => typeof r.c === "number" && Number.isFinite(r.c))
      .map((r) => ({ entryId: r.candidate_ref, kind: r.kind, confidence: r.c as number, at: r.created_at }));
  } catch (err) {
    // The decision store creates its table lazily: on a cold DB "no confidence sealed"
    // is the truth. Anything else is a real fault and propagates.
    if (!/no such table/i.test(String((err as Error)?.message))) throw err;
  }
  const stages = getPipelineAxis(workspaceId).stages;
  const terminal = stagesWithRole("terminal", stages)[0];
  const terminalIndex = terminal ? stages.findIndex((s) => s.id === terminal) : stages.length - 1;
  return {
    entries,
    events,
    confidences,
    axis: { stages: stages.map((s) => s.id), advanceIndex: screeningGateIndex(stages), terminalIndex },
  };
}
