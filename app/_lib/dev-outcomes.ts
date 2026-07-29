import Database from "better-sqlite3";
import { openStore } from "./db-path";
import { DEFAULT_WORKSPACE_ID } from "./db/workspaces";
import { z } from "zod";

// Direction E — the outcome loop. Record what actually happened to promoted candidates
// (hired / rejected, and on-the-job performance) and CALIBRATE the pipeline's thresholds
// against reality: did a high predicted score actually predict a good outcome? Self-contained
// connection (own table) to stay clear of the main schema while the fork churns it.

// ── Canonical outcome vocabulary ─────────────────────────────────────────────
// These four labels are the ONLY values the store accepts. Before this was enforced,
// recordOutcome took any free-text string while calibrate() only counts exact "hired"/
// "rejected" — so a typo ("Hired", "hire", "withdrew") was silently recorded but dropped
// from calibration, biasing the promote-floor suggestion with no warning. The enum +
// boundary validation make the contract explicit and keep the learning loop honest.
//   • hired     — candidate was hired (the only outcome that carries a performance score)
//   • rejected  — candidate was turned down
//   • withdrawn — candidate withdrew themselves (not counted as a decided signal)
//   • pending   — outcome not yet known (not counted as a decided signal)
export const OUTCOMES = ["hired", "rejected", "withdrawn", "pending"] as const;
export type Outcome = (typeof OUTCOMES)[number];

// Performance is a 1..5 on-the-job rating that is ONLY meaningful for a hire — there is no
// performance to rate for a candidate who was rejected, withdrew, or is still pending.
export const PERFORMANCE_MIN = 1;
export const PERFORMANCE_MAX = 5;

// Single source of truth for the recordOutcome data contract. Validated at the
// /api/devcase/outcomes boundary so a bad label or out-of-range score can never reach
// the calibration store. The cross-field rule (performance only for "hired") is enforced
// here too, so the meanPerformance bands can never be skewed by a stray score.
export const outcomeInputSchema = z
  .object({
    ref: z.string().optional(),
    candidateRef: z.string().optional(),
    // The predicted score MUST sit on the same 0..100 scale the calibration bands
    // cover. An out-of-range value (a typo like 850, or a negative) would still
    // count toward the resolved sample yet fall into NO band, so the engine would
    // compute a floor suggestion over fewer in-band outcomes than the count it
    // advertises — a falsely confident, biased recommendation. Bound it here.
    predictedScore: z
      .number()
      .min(0, { error: "predictedScore must be between 0 and 100" })
      .max(100, { error: "predictedScore must be between 0 and 100" })
      .optional(),
    outcome: z.enum(OUTCOMES, { error: `outcome must be one of: ${OUTCOMES.join(", ")}` }),
    performance: z
      .number()
      .int({ error: "performance must be a whole number" })
      .min(PERFORMANCE_MIN, { error: `performance must be between ${PERFORMANCE_MIN} and ${PERFORMANCE_MAX}` })
      .max(PERFORMANCE_MAX, { error: `performance must be between ${PERFORMANCE_MIN} and ${PERFORMANCE_MAX}` })
      .optional(),
    note: z.string().optional(),
  })
  .refine((v) => v.performance == null || v.outcome === "hired", {
    error: "performance applies only to a 'hired' outcome",
    path: ["performance"],
  });

export type OutcomeInput = z.infer<typeof outcomeInputSchema>;

let _db: Database.Database | null = null;
function db(): Database.Database {
  if (_db) return _db;
  // Own connection to the shared kp.sqlite file (db.ts + dev-control open theirs)
  // with the canonical isolated-store pragmas (WAL + busy_timeout=5000): WAL
  // serializes writers, so without the busy_timeout a recordOutcome racing a
  // lifecycle/API write would instantly throw SQLITE_BUSY; wait briefly instead.
  const d = openStore();
  d.exec(`
    CREATE TABLE IF NOT EXISTS dev_outcomes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ref TEXT,
      candidate_ref TEXT,
      predicted_score INTEGER,
      outcome TEXT NOT NULL,
      performance INTEGER,
      note TEXT,
      recorded_at TEXT NOT NULL,
      workspace_id TEXT NOT NULL DEFAULT '${DEFAULT_WORKSPACE_ID}'
    );
    CREATE INDEX IF NOT EXISTS idx_dev_outcomes_created ON dev_outcomes (id DESC);
  `);
  // Tenancy scoping (D5): calibration is PER-TEAM, not deployment-global. Without the
  // column two teams' hire/reject outcomes pooled into one corpus, so the promote-floor
  // recommendation a recruiter acts on was computed from another team's hiring reality.
  // Isolated store (own openStore connection, no core.ts migrator) → migrate here, the
  // same shape onboarding-store.ts uses. Pre-existing rows backfill to the default
  // workspace via the column DEFAULT — the tenant every row was implicitly written for
  // while the studio was single-tenant, so no historical calibration is lost.
  const cols = d.prepare(`PRAGMA table_info(dev_outcomes)`).all() as { name: string }[];
  if (!cols.some((c) => c.name === "workspace_id")) {
    d.exec(`ALTER TABLE dev_outcomes ADD COLUMN workspace_id TEXT NOT NULL DEFAULT '${DEFAULT_WORKSPACE_ID}'`);
  }
  // Every read is now (workspace_id, …); created after the ALTER so it also covers a
  // migrated legacy table.
  d.exec(`CREATE INDEX IF NOT EXISTS idx_dev_outcomes_ws ON dev_outcomes (workspace_id, id DESC)`);
  _db = d;
  return d;
}

export type OutcomeRecord = {
  id: number;
  ref: string | null;
  candidateRef: string | null;
  predictedScore: number | null;
  outcome: Outcome;
  performance: number | null; // PERFORMANCE_MIN..PERFORMANCE_MAX, only set when outcome === "hired"
  note: string | null;
  recordedAt: string;
};

// Persist a single outcome. `input` is expected to already be validated against
// `outcomeInputSchema` at the API boundary — that is where the canonical vocabulary and the
// 1..5 / hired-only performance rule are enforced, keeping the calibration inputs honest.
//
// UPSERT, not blind INSERT (biz-scan 2026-06-12): calibrate() counts every decided row
// individually, so a re-record of the same real-world fact — a remounted SubmissionRow
// re-offering its buttons, or the control-room form re-typing a candidate the pipeline
// already auto-recorded — used to land as a second row that double-counted in the bands
// (at MIN RESOLVED = 4 a single duplicate can move suggestedFloor a whole tier). The row
// this input is "about" is found by:
//   • `ref` (the submission id, by contract) when present — one row per submission,
//     the latest recorded reality wins;
//   • otherwise the newest row with the same trimmed candidateRef AND outcome, so a
//     refless "add a perf score to the alice hire" updates the existing hire instead of
//     minting a second decided outcome. A different outcome for the same name is NOT a
//     correction — it stays a fresh row (e.g. the same candidate across two postings).
// Absent fields keep the existing row's values (an update never erases what it didn't say),
// except performance, which only rides a "hired" outcome — flipping hired → rejected must
// drop the stale score or the schema's cross-field rule would be violated at rest.
//
// TENANT SCOPE (D5): the dedup lookups AND the insert are workspace-scoped, so one team's
// re-record can never update — nor be blocked by — another team's row for the same ref or
// candidate name.
export function recordOutcome(input: OutcomeInput, workspaceId: string = DEFAULT_WORKSPACE_ID): "inserted" | "updated" {
  const d = db();
  const candidate = input.candidateRef?.trim();
  let existing = (
    input.ref != null
      ? d.prepare(`SELECT id, predicted_score, performance, note FROM dev_outcomes WHERE workspace_id = ? AND ref = ? ORDER BY id DESC LIMIT 1`).get(workspaceId, input.ref)
      : candidate
        ? d
            .prepare(`SELECT id, predicted_score, performance, note FROM dev_outcomes WHERE workspace_id = ? AND TRIM(COALESCE(candidate_ref, '')) = ? AND outcome = ? ORDER BY id DESC LIMIT 1`)
            .get(workspaceId, candidate, input.outcome)
        : undefined
  ) as { id: number; predicted_score: number | null; performance: number | null; note: string | null } | undefined;
  // bug-ui-scan-2026-07-09 (dev-lifecycle-cohort-outcomes #3): the refless identity key
  // (trimmed candidateRef, outcome) is neither unique nor stable — two DIFFERENT real people
  // who share a candidateRef (a common name) and outcome would collapse into one row, the
  // second record silently OVERWRITING the first's predictedScore and biasing calibration.
  // A refless entry that asserts its OWN predicted score DIFFERENT from the matched row's is
  // therefore a distinct outcome (a different candidate / posting), not a completion — insert
  // it rather than merge. A refless entry with no score (or the same score) is still a
  // completion of the matched row (e.g. "add a perf score to the alice hire") and updates in
  // place, so the auto-hire dedup path is unaffected. (The ref path is exact identity and is
  // never second-guessed.) NOTE: a same-name/same-score/same-outcome collision between two
  // real people remains indistinguishable without a `ref` — the residual the fix can't reach.
  if (
    existing &&
    input.ref == null &&
    input.predictedScore != null &&
    existing.predicted_score != null &&
    input.predictedScore !== existing.predicted_score
  ) {
    existing = undefined;
  }
  if (existing) {
    d.prepare(`UPDATE dev_outcomes SET predicted_score = ?, outcome = ?, performance = ?, note = ?, recorded_at = ? WHERE id = ?`).run(
      input.predictedScore ?? existing.predicted_score,
      input.outcome,
      input.outcome === "hired" ? input.performance ?? existing.performance : null,
      input.note ?? existing.note,
      new Date().toISOString(),
      existing.id
    );
    return "updated";
  }
  d.prepare(`INSERT INTO dev_outcomes (ref, candidate_ref, predicted_score, outcome, performance, note, recorded_at, workspace_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
    input.ref ?? null,
    input.candidateRef ?? null,
    input.predictedScore ?? null,
    input.outcome,
    input.performance ?? null,
    input.note ?? null,
    new Date().toISOString(),
    workspaceId
  );
  return "inserted";
}

// W5-2 (DEVO2) — auto-feed the calibration loop from the pipeline's terminal
// transitions. A promoted submission becomes a "ds-<submissionId>" pipeline
// entry carrying its transferScore as matchScore; when that entry is rejected
// or hired, the system already knows everything the manual control-room form
// asked a human to re-type. The "ds-" prefix check mirrors
// student-interview.submissionIdFromCandidateId — kept inline here because
// importing it would pull student-interview's db.ts dependency into this
// deliberately self-contained store (the prefix is minted in
// devcase-run.promoteSubmission and is a stable contract).
export function recordPipelineOutcome(
  entry: { candidateId: string | null; candidateLabel: string | null; matchScore: number | null },
  outcome: "hired" | "rejected"
): boolean {
  const cid = entry.candidateId;
  if (!cid || !cid.startsWith("ds-")) return false;
  const ref = cid.slice(3);
  // Tenant DERIVATION (D5), the same pattern devcase.ts uses for outbox/postings/
  // submissions: the auto-record's tenant is the workspace of the SUBMISSION the ref
  // names, read straight from the shared sqlite file. Deriving it here (rather than
  // threading a workspace argument) keeps the two callers — pipeline.actOnPipelineEntry
  // and offer-finalize — unchanged: PipelineEntry carries no workspaceId, so a parameter
  // would have silently defaulted anyway and every auto-recorded outcome would land in
  // the default tenant's calibration corpus regardless of whose hire it was.
  const workspaceId = workspaceForSubmissionRef(ref);
  // Idempotent across re-transitions (a re-add later re-rejected must not
  // double-count in the calibration bands).
  const existing = db().prepare(`SELECT 1 FROM dev_outcomes WHERE workspace_id = ? AND ref = ? AND outcome = ? LIMIT 1`).get(workspaceId, ref, outcome);
  if (existing) return false;
  const predicted =
    typeof entry.matchScore === "number" && entry.matchScore >= 0 && entry.matchScore <= 100
      ? entry.matchScore
      : undefined;
  recordOutcome({
    ref,
    candidateRef: entry.candidateLabel ?? undefined,
    predictedScore: predicted,
    outcome,
    note: `auto-recorded from pipeline ${outcome === "hired" ? "hire" : "rejection"}`,
  }, workspaceId);
  return true;
}

// The workspace a promoted submission belongs to. dev_submissions lives on db/core.ts's
// connection but in the SAME sqlite file, so this store can read it directly (it already
// shares the file with db.ts + dev-control). Falls back to the default tenant when the
// table has not been created yet (a bare store process) or the ref is unknown — the
// pre-D5 behaviour, never a throw: calibration must never fail a hire or a rejection.
function workspaceForSubmissionRef(ref: string): string {
  try {
    const row = db().prepare(`SELECT workspace_id FROM dev_submissions WHERE id = ?`).get(ref) as { workspace_id?: string } | undefined;
    return row?.workspace_id ?? DEFAULT_WORKSPACE_ID;
  } catch {
    return DEFAULT_WORKSPACE_ID;
  }
}

export function listOutcomes(limit = 80, workspaceId: string = DEFAULT_WORKSPACE_ID): OutcomeRecord[] {
  const rows = db()
    .prepare(`SELECT * FROM dev_outcomes WHERE workspace_id = ? ORDER BY id DESC LIMIT ?`)
    .all(workspaceId, limit) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: r.id as number,
    ref: (r.ref as string) ?? null,
    candidateRef: (r.candidate_ref as string) ?? null,
    predictedScore: r.predicted_score == null ? null : Number(r.predicted_score),
    // Rows written before boundary validation may hold legacy free-text labels; they simply
    // fall outside the canonical set and are excluded from calibration, exactly as before.
    outcome: r.outcome as Outcome,
    performance: r.performance == null ? null : Number(r.performance),
    note: (r.note as string) ?? null,
    recordedAt: r.recorded_at as string,
  }));
}

// The slice of an outcome row the postings GET joins onto each submission (the
// submission id IS the `ref` by contract — SubmissionRow posts it, recordPipelineOutcome
// derives it from the "ds-" candidate id). Without this join, `recorded` lived only in
// component state: any remount re-offered the Hired/Rejected/Withdrawn buttons for a
// submission whose outcome was already on file.
export type OutcomeSummary = { outcome: Outcome; performance: number | null; recordedAt: string };

// Latest recorded outcome per ref, for the given refs only. Upserts keep one row per
// ref going forward, but rows written before that (or a legacy import) can repeat a
// ref — scanning in id order and letting the map overwrite makes the newest row win
// either way. Unknown refs are simply absent from the result.
export function latestOutcomeByRefs(refs: string[], workspaceId: string = DEFAULT_WORKSPACE_ID): Map<string, OutcomeSummary> {
  const latest = new Map<string, OutcomeSummary>();
  if (refs.length === 0) return latest;
  const placeholders = refs.map(() => "?").join(", ");
  const rows = db()
    .prepare(`SELECT ref, outcome, performance, recorded_at FROM dev_outcomes WHERE workspace_id = ? AND ref IN (${placeholders}) ORDER BY id ASC`)
    .all(workspaceId, ...refs) as Array<Record<string, unknown>>;
  for (const r of rows) {
    latest.set(r.ref as string, {
      outcome: r.outcome as Outcome,
      performance: r.performance == null ? null : Number(r.performance),
      recordedAt: r.recorded_at as string,
    });
  }
  return latest;
}

// Fixed predicted-score buckets used to ask "do higher scores actually convert better?".
// The four boundaries [0, 55, 70, 85, 101] are HAND-CHOSEN tiers, not learned from data — they
// stay constant no matter how many outcomes accumulate:
//   • 55  is the default promote floor (DEV_POLICY.promoteFloor), so the first band [0–54] is
//         exactly the "scored below the floor" region — candidates that normally wouldn't be
//         promoted at all. Anchoring band 1 to the live default keeps the chart legible.
//   • 70 and 85 split the promotable range into borderline (55–69), good (70–84) and strong
//         (85+) tiers — round, legible cut-points, NOT fitted to the observed hire rates.
//   • 101 (not 100) is the top bound because band membership is a half-open [lo, hi) test in
//         calibrate() below; using 101 makes a perfect score of 100 fall into the top band
//         instead of being dropped by the strict `< hi` comparison.
// Because the cuts are fixed, any single band can hold very few outcomes (even n = 1). See the
// SMALL-SAMPLE caveat on calibrate() — a near-empty band can swing `predictive`/`suggestedFloor`.
const BANDS: Array<[number, number]> = [
  [0, 55],
  [55, 70],
  [70, 85],
  [85, 101],
];
const bandLabel = (lo: number, hi: number) => (hi >= 101 ? `${lo}+` : `${lo}–${hi - 1}`);

export type CalibrationBand = { label: string; lo: number; count: number; hireRate: number | null; meanPerformance: number | null };
export type Calibration = {
  resolved: number;
  bands: CalibrationBand[];
  predictive: boolean | null;
  currentFloor: number;
  suggestedFloor: number | null;
  rationale: string;
};

// Bucket resolved outcomes by predicted-score band and read whether higher scores actually
// produced more hires / better performance — then suggest where the promote floor should sit.
//
// This output is acted on by a HUMAN: the "Apply suggested → N" button on the control page moves
// the live promote floor to `suggestedFloor`. So each threshold below is documented with what it
// means and why it holds that value (none of these are tuned/learned — they are deliberate,
// defensible defaults):
//   • MIN RESOLVED = 4 — do not calibrate until at least 4 *decided* (hired|rejected) outcomes
//     WITH AN IN-RANGE predicted score exist (the only ones a band can hold). Below that the
//     bands are too sparse for any hire-rate comparison to mean anything.
//     4 is a low "show me *something*" bar, not a statistically powered sample — it just stops
//     the engine from making a recommendation off one or two data points.
//   • MONOTONICITY TOLERANCE = 0.05 — "predictive" means each populated band's hire rate is at
//     least as high as the previous (lower-score) band's, i.e. higher scores → more hires. We
//     permit a 5-percentage-point dip before declaring the trend broken, so ordinary sampling
//     noise doesn't flip a genuinely-rising trend to "not predictive". The 0.05 is a judgement
//     call (small enough to catch real reversals, loose enough to ignore jitter), not derived.
//   • MAJORITY-HIRE THRESHOLD = 0.5 — the suggested floor is the lowest band where a simple
//     majority (≥ 50%) of promoted candidates were actually hired: the cheapest band that "pays
//     off" more often than not. 0.5 is a plain coin-flip majority, chosen for being an obvious,
//     defensible cut rather than an optimised one.
//   • NO-CONVERGING-BAND FALLBACK = 85 — when NO band reaches the 0.5 hire rate, fall back to 85
//     (the floor of the top BANDS tier): the most conservative advice available — "only promote
//     the very strongest until the data shows a lower band converting".
//
// SMALL-SAMPLE CAVEAT (why a suggestion can be noise): because BANDS are fixed, a band can be
// decided by a single outcome. At n = 1 a band's hireRate is forced to exactly 0.0 or 1.0, so
// one hire or one rejection can (a) break or restore the monotonic trend and flip `predictive`,
// and (b) make or break the ≥ 0.5 majority test and so move `suggestedFloor` by a whole tier.
// Treat a suggestion backed by low-`count` bands as a weak signal, not proof; prefer waiting for
// more outcomes over reacting to a near-empty band. NOTE the MIN RESOLVED = 4 gate is on the
// TOTAL in-range decided count, not per-band — individual bands can still be tiny once it passes.
//
// TENANT SCOPE (D5): the corpus is the CALLER'S workspace only. Pooling teams meant a
// recruiter's "Apply suggested → N" button moved their live promote floor to a number
// derived from another team's hires — the algorithm below is unchanged, only its input set.
export function calibrate(currentFloor: number, workspaceId: string = DEFAULT_WORKSPACE_ID): Calibration {
  const all = listOutcomes(1000, workspaceId);
  const decided = all.filter((o) => o.outcome === "hired" || o.outcome === "rejected"); // exclude pending/withdrawn
  // Only decided outcomes whose predicted score lands inside the banded range
  // [RANGE_LO, RANGE_HI) inform calibration. A null/absent score — or a legacy,
  // pre-validation out-of-range one (a typo like 850, a negative) — buckets into
  // NO band, so counting it toward the resolved sample would advertise more
  // outcomes than the bands actually hold and bias the human-facing floor
  // suggestion. The gate and `resolved` below therefore use this in-range count,
  // not the raw decided count. New inputs are bounded to 0..100 at the boundary
  // (outcomeInputSchema), so out-of-range data can only be pre-existing rows.
  const RANGE_LO = BANDS[0][0];
  const RANGE_HI = BANDS[BANDS.length - 1][1];
  const inRange = decided.filter(
    (o) => o.predictedScore != null && o.predictedScore >= RANGE_LO && o.predictedScore < RANGE_HI
  );
  const bands: CalibrationBand[] = BANDS.map(([lo, hi]) => {
    const inBand = inRange.filter((o) => (o.predictedScore as number) >= lo && (o.predictedScore as number) < hi);
    const hires = inBand.filter((o) => o.outcome === "hired");
    const perfs = hires.map((o) => o.performance).filter((p): p is number => typeof p === "number");
    return {
      label: bandLabel(lo, hi),
      lo,
      count: inBand.length,
      hireRate: inBand.length ? Math.round((hires.length / inBand.length) * 100) / 100 : null,
      meanPerformance: perfs.length ? Math.round((perfs.reduce((a, b) => a + b, 0) / perfs.length) * 10) / 10 : null,
    };
  });

  // Invariant: BANDS partition [RANGE_LO, RANGE_HI) with no gaps or overlaps, so
  // every in-range decided outcome lands in exactly one band. If the band counts
  // ever fail to sum to the in-range count, a band definition introduced a gap or
  // overlap — fail loud rather than silently compute a floor suggestion over a
  // sample that doesn't match the `resolved` count shown to the human.
  const bandTotal = bands.reduce((sum, b) => sum + b.count, 0);
  if (bandTotal !== inRange.length) {
    throw new Error(
      `calibration band accounting mismatch: bands sum ${bandTotal} != ${inRange.length} in-range decided outcomes`
    );
  }

  // MIN RESOLVED gate (see docstring): too few in-range decided outcomes for any band comparison
  // to be meaningful, so we make no recommendation rather than one driven by one or two data points.
  if (inRange.length < 4) {
    return { resolved: inRange.length, bands, predictive: null, currentFloor, suggestedFloor: null, rationale: "Not enough resolved outcomes yet to calibrate (need ≥ 4)." };
  }

  // monotonic-ish: each populated band's hire rate >= the previous populated band's, within the
  // 0.05 MONOTONICITY TOLERANCE (see docstring) so a small noise dip doesn't read as a reversal.
  const populated = bands.filter((b) => b.count > 0 && b.hireRate != null);
  let predictive = true;
  for (let i = 1; i < populated.length; i += 1) {
    if ((populated[i].hireRate ?? 0) + 0.05 < (populated[i - 1].hireRate ?? 0)) predictive = false;
  }

  // suggested floor: the lowest band where a majority (≥ 0.5 MAJORITY-HIRE THRESHOLD) of promoted
  // candidates actually got hired; the 85 FALLBACK (top BANDS tier) is the most conservative
  // advice when no band converts at all. See docstring for why these values and the n=1 caveat.
  const good = populated.find((b) => (b.hireRate ?? 0) >= 0.5);
  const suggestedFloor = good ? good.lo : 85;

  let rationale: string;
  if (!predictive) {
    rationale = "Scores are only weakly predictive — hire rate doesn't rise cleanly with the score. Investigate the rubric before moving the floor.";
  } else if (suggestedFloor > currentFloor) {
    rationale = `Candidates below ${suggestedFloor} rarely converted; the floor of ${currentFloor} is letting weak matches through. Consider raising it to ${suggestedFloor}.`;
  } else if (suggestedFloor < currentFloor) {
    rationale = `Candidates from ${suggestedFloor}–${currentFloor} converted well; the floor of ${currentFloor} may be too strict. Consider lowering it to ${suggestedFloor}.`;
  } else {
    rationale = `The floor of ${currentFloor} is well-calibrated — it sits at the first band where most promoted candidates were hired.`;
  }

  return { resolved: inRange.length, bands, predictive, currentFloor, suggestedFloor, rationale };
}
