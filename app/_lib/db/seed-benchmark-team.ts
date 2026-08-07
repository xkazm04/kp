import type Database from "better-sqlite3";

const BENCH_TEAM = "ws-benchmark-north";

// A 2nd team in the default org (org-default) so the Phase-2 ORG BENCHMARK (org_id-join,
// k-anon) has cross-team data to aggregate + compare against. INERT in single-tenant —
// every recruiter read scopes to 'workspace' — so this team never appears on the board,
// the analytics, or any per-team surface; only orgHiringBenchmark, which joins by org_id,
// sees it. Idempotent: the entries are seeded once, keyed off the team's own emptiness.
//
// Seeds via a DIRECT INSERT on the passed handle (not createPipelineEntry): it runs
// INSIDE ensureDb's init, before __kpDb is memoized, so calling ensureDb() again would
// re-enter the whole initializer. The benchmark reads pipeline_entries only, so no
// pipeline_event is needed for these rows.
export function seedBenchmarkTeam(db: Database.Database): void {
  db.prepare(
    `INSERT OR IGNORE INTO workspaces (id, name, org_id, type, created_at) VALUES (?, ?, 'org-default', 'team', ?)`
  ).run(BENCH_TEAM, "Talent Acquisition — North", "2026-01-01T00:00:00.000Z");
  const existing = (db.prepare(`SELECT COUNT(*) AS n FROM pipeline_entries WHERE workspace_id = ?`).get(BENCH_TEAM) as { n: number }).n;
  if (existing > 0) return;

  // A DIFFERENT-shaped funnel than the default team's, so the "you vs the org" compare is
  // non-trivial: [stage, createdDayOffset, daysToStageChange]. An Accepted row hasn't
  // advanced (changed = created); a Hired row's daysToStageChange IS its time-to-hire.
  const day = 86_400_000;
  const base = Date.parse("2026-02-01T09:00:00.000Z");
  const iso = (d: number) => new Date(base + d * day).toISOString();
  const spec: Array<[string, number, number]> = [
    ["Accepted", 0, 0], ["Accepted", 2, 0], ["Accepted", 5, 0], ["Accepted", 9, 0],
    ["Accepted", 12, 0], ["Accepted", 15, 0], ["Accepted", 18, 0], ["Accepted", 21, 0],
    ["Screened", 1, 2], ["Screened", 4, 3], ["Screened", 7, 2], ["Screened", 10, 4], ["Screened", 13, 3], ["Screened", 16, 2],
    ["Interview", 3, 7], ["Interview", 6, 8], ["Interview", 8, 6], ["Interview", 11, 9], ["Interview", 14, 7],
    ["Offer", 2, 14], ["Offer", 9, 12],
    ["Hired", 0, 20], ["Hired", 5, 26], ["Hired", 12, 31],
  ];
  const ins = db.prepare(
    `INSERT INTO pipeline_entries
       (id, candidate_id, candidate_label, job_id, job_title, stage, status, created_at, stage_changed_at, updated_at, workspace_id)
     VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`
  );
  spec.forEach(([stage, created, ttl], i) => {
    ins.run(
      `m-bench-${i}-job-000`,
      `bench-${i}`,
      `Reference candidate ${i + 1}`,
      "job-000",
      "Reference role",
      stage,
      iso(created),
      iso(created + ttl),
      iso(created + ttl),
      BENCH_TEAM
    );
  });
}
