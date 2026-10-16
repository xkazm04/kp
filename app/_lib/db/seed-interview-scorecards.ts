import type Database from "better-sqlite3";
import { markSeedRan, seedAlreadyRan } from "./seed-marks";

// The demo corpus' completed interviews: the SCORECARD arm of `npm run kpi:reasons`.
//
// The seed corpus held 66 pipeline entries and not one interview session, so on a fresh
// install the reasons-coverage meter read "scorecard: not measured" until somebody had
// exercised the voice pipeline. This gives it a denominator that is true to the product:
// a handful of COMPLETED candidate-mode sessions attached to seeded entries that already
// stand at or past the interview column, with scorecards in the shape the synthesis
// writes (interview-scorecard.ts).
//
// ONE of them is the all-"Not assessed" scorecard on purpose. That is the failure the
// scorecard arm exists to catch (a scorecard whose every axis is placeholder evidence
// looks complete and has no reasons block), so the corpus itself exercises the MISS path
// instead of only a fixture doing so. The meter therefore reads under 100% on a fresh
// install, truthfully, and that is the point of it.
//
// Not covered here: the REJECTION arm. Those are SEALED auto_rejected decision records;
// sealing goes through decision-record-store's keyed hash chain on its own connection, so
// it cannot run inside ensureDb's initializer, and it must not be forged by a raw INSERT.
//
// One-shot via seed_marks (never COUNT(*) > 0, db/seed-marks.ts): an operator who deletes
// these sessions does not get them back on the next boot. Direct INSERT on the passed
// handle for the same reason as seed-benchmark-team.ts: it runs INSIDE ensureDb's init.

const SEED_MARK = "interview-scorecards";
const DAY = 86_400_000;

/** Stages whose entries have plausibly been interviewed. Wire codes of the shipped board;
 *  a workspace that renamed its columns simply gets fewer (or no) sessions. */
const INTERVIEWED_STAGES = ["Interview", "Offer", "Hired"];

const COMPETENCIES = ["Technical depth", "Problem-solving", "Communication", "Experience & fit", "Motivation"] as const;

type Plan = { recommendation: "advance" | "hold" | "reject"; summary: string; evidence: readonly (string | null)[] };

const NOT_ASSESSED = "Not assessed.";

// Evidence is the candidate's own words, as the synthesis quotes them. `null` = the axis
// was never reached, which the synthesis stores as a mid-scale 3 with placeholder evidence.
const PLANS: readonly Plan[] = [
  {
    recommendation: "advance",
    summary: "Strong backend fundamentals with clear examples; advance to the next round.",
    evidence: [
      "I moved the settlement batch to idempotent consumers so a replay could not double-book.",
      "I bisected the failure to one slow query and added the missing index before touching code.",
      "I wrote the runbook myself so the on-call did not need me.",
      "Six years on payment services, the last two owning the ledger.",
      "I want to own a domain end to end, not hand tickets over.",
    ],
  },
  {
    recommendation: "hold",
    summary: "Solid communication, thinner on depth; two axes were not reached in the call.",
    evidence: [
      "We used Spring for the REST layer and Kafka between services.",
      null,
      "I explained the trade-off to the product owner with a one-page note.",
      null,
      "The domain is interesting to me and the team is close to home.",
    ],
  },
  {
    recommendation: "advance",
    summary: "Clear owner mindset; evidence on four of five axes.",
    evidence: [
      "I replaced the polling loop with a queue consumer and cut p99 by a third.",
      "I reproduced it locally first, then wrote the test that failed for the right reason.",
      "I keep the changelog readable for people outside engineering.",
      null,
      "I left my last role because the roadmap stopped being ours to decide.",
    ],
  },
  {
    // The corpus' own MISS: the call ended before any rubric axis was reached.
    recommendation: "hold",
    summary: "The call ended early; no rubric axis was assessed.",
    evidence: [null, null, null, null, null],
  },
];

function scorecardJson(plan: Plan, endedAt: string): string {
  return JSON.stringify({
    source: "ai",
    ratings: COMPETENCIES.map((competency, i) => {
      const quote = plan.evidence[i];
      // 3 of 5 with placeholder evidence is exactly what the synthesis stores for an
      // untouched axis (NOT_ASSESSED_RATING); a real axis varies so the grid is not flat.
      return quote ? { competency, rating: 3 + ((i + plan.summary.length) % 3), evidence: quote } : { competency, rating: 3, evidence: NOT_ASSESSED };
    }),
    summary: plan.summary,
    recommendation: plan.recommendation,
    scoringModel: "experienced",
    generatedAt: endedAt,
  });
}

export function seedInterviewScorecards(db: Database.Database): void {
  if (seedAlreadyRan(db, SEED_MARK)) return;
  // Only the seeded corpus' own rows (ids `pe-*`): a real candidate is never given a
  // fabricated interview, and a (SIM) walk's rows are purged by resetSim anyway.
  const entries = db
    .prepare(
      `SELECT id, candidate_label, job_id, job_title, workspace_id FROM pipeline_entries
        WHERE id LIKE 'pe-%' AND status = 'active' AND stage IN (${INTERVIEWED_STAGES.map(() => "?").join(",")})
          AND job_id IS NOT NULL AND job_title NOT LIKE '%(SIM)%'
        ORDER BY id LIMIT ?`
    )
    .all(...INTERVIEWED_STAGES, PLANS.length) as {
    id: string;
    candidate_label: string | null;
    job_id: string;
    job_title: string | null;
    workspace_id: string | null;
  }[];
  // No seeded entries to attach to (an emptied or renamed pipeline): nothing to seed, and
  // the mark still lands - the question this answers is "did this seeder run", not "did
  // it find rows".
  const insert = db.prepare(
    `INSERT OR IGNORE INTO interview_sessions
       (id, entry_id, candidate_label, job_id, job_title, provider, language, mode, status,
        duration_min, started_at, ended_at, scorecard_json, created_at, updated_at, workspace_id)
     VALUES (?, ?, ?, ?, ?, 'openai', 'en', 'candidate', 'completed', ?, ?, ?, ?, ?, ?, ?)`
  );
  const nowMs = Date.now();
  db.transaction(() => {
    entries.forEach((e, i) => {
      const endedAt = new Date(nowMs - (i + 1) * 2 * DAY).toISOString();
      const startedAt = new Date(Date.parse(endedAt) - 20 * 60_000).toISOString();
      insert.run(
        `is-seed-${e.id}`,
        e.id,
        e.candidate_label,
        e.job_id,
        e.job_title,
        20,
        startedAt,
        endedAt,
        scorecardJson(PLANS[i], endedAt),
        startedAt,
        endedAt,
        e.workspace_id ?? "workspace"
      );
    });
    markSeedRan(db, SEED_MARK);
  })();
}
