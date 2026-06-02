import path from "node:path";
import { mkdirSync } from "node:fs";
import Database from "better-sqlite3";
import { z } from "zod";

// Direction E — the outcome loop. Record what actually happened to promoted candidates
// (hired / rejected, and on-the-job performance) and CALIBRATE the pipeline's thresholds
// against reality: did a high predicted score actually predict a good outcome? Self-contained
// connection (own table) to stay clear of the main schema while the fork churns it.
const DB_PATH = process.env.KP_DB_PATH ?? path.join(process.cwd(), "data", "kp.sqlite");

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
    predictedScore: z.number().optional(),
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
  mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const d = new Database(DB_PATH);
  d.pragma("journal_mode = WAL");
  d.exec(`
    CREATE TABLE IF NOT EXISTS dev_outcomes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ref TEXT,
      candidate_ref TEXT,
      predicted_score INTEGER,
      outcome TEXT NOT NULL,
      performance INTEGER,
      note TEXT,
      recorded_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_dev_outcomes_created ON dev_outcomes (id DESC);
  `);
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
export function recordOutcome(input: OutcomeInput): void {
  db()
    .prepare(`INSERT INTO dev_outcomes (ref, candidate_ref, predicted_score, outcome, performance, note, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(
      input.ref ?? null,
      input.candidateRef ?? null,
      input.predictedScore ?? null,
      input.outcome,
      input.performance ?? null,
      input.note ?? null,
      new Date().toISOString()
    );
}

export function listOutcomes(limit = 80): OutcomeRecord[] {
  const rows = db().prepare(`SELECT * FROM dev_outcomes ORDER BY id DESC LIMIT ?`).all(limit) as Array<Record<string, unknown>>;
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
export function calibrate(currentFloor: number): Calibration {
  const all = listOutcomes(1000);
  const decided = all.filter((o) => o.outcome === "hired" || o.outcome === "rejected"); // exclude pending/withdrawn
  const bands: CalibrationBand[] = BANDS.map(([lo, hi]) => {
    const inBand = decided.filter((o) => (o.predictedScore ?? -1) >= lo && (o.predictedScore ?? -1) < hi);
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

  if (decided.length < 4) {
    return { resolved: decided.length, bands, predictive: null, currentFloor, suggestedFloor: null, rationale: "Not enough resolved outcomes yet to calibrate (need ≥ 4)." };
  }

  // monotonic-ish: each populated band's hire rate >= the previous populated band's
  const populated = bands.filter((b) => b.count > 0 && b.hireRate != null);
  let predictive = true;
  for (let i = 1; i < populated.length; i += 1) {
    if ((populated[i].hireRate ?? 0) + 0.05 < (populated[i - 1].hireRate ?? 0)) predictive = false;
  }

  // suggested floor: the lowest band where the majority of promoted candidates actually got hired
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

  return { resolved: decided.length, bands, predictive, currentFloor, suggestedFloor, rationale };
}
