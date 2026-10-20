// channel-story-complete, then challenge-r06 analytics-computation/A.
//
// The slim prior-window aggregation (pipelineAnalyticsPrior) must return EXACTLY what
// periodDeltas reads off the full pipelineAnalytics battery for the prior window — both
// now fold through the one pure cohort function (analytics-cohort.ts), and this file
// pins that they still agree over a seeded cohort.
//
// What CHANGED ON PURPOSE (r06): this file used to pin, as the contract, that the
// prior window's per-source read was LOWER-BOUND ONLY — "an entry created 5 days ago
// falls AFTER the window's upper bound: excluded from the cohort but INCLUDED in
// bySource — the exact asymmetry the slim function must reproduce". That asymmetry was
// a leak: the prior window's source volume counted every candidate of the CURRENT
// window. It now pins the opposite: both windows are half-open, they tile, and no read
// of the prior window sees a row at or after its end. And the prior cohort is judged
// as it stood at its own end (a hire that landed later is not a prior-window hire),
// so the headline hire-rate and time-to-hire deltas compare equally mature cohorts.
//
// Isolated throwaway DB (testing/unit-db.ts must stay the first project import).
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { pipelineAnalytics, pipelineAnalyticsPrior, type PipelineAnalytics } from "./analytics.ts";
import { createPipelineEntry } from "./pipeline.ts";
import { ensureDb } from "./core.ts";
import { getPipelineAxis } from "../pipeline-axis-server.ts";
import { deltaWindows, foldCohort, type CohortRow } from "../analytics-cohort.ts";

after(() => cleanupUnitDb());

const DAY = 86_400_000;

/** Backdate an entry's cohort timestamps + attribution the way real rows carry them. */
function place(
  id: string,
  opts: { createdDaysAgo: number; channel: string | null; hiredDaysAgo?: number; now?: number; createdAtMs?: number }
): void {
  const db = ensureDb();
  const now = opts.now ?? Date.now();
  const createdMs = opts.createdAtMs ?? now - opts.createdDaysAgo * DAY;
  const createdAt = new Date(createdMs).toISOString();
  const stageChangedAt = opts.hiredDaysAgo != null ? new Date(now - opts.hiredDaysAgo * DAY).toISOString() : createdAt;
  db.prepare(`UPDATE pipeline_entries SET created_at = ?, stage_changed_at = ?, source_channel = ? WHERE id = ?`).run(
    createdAt,
    stageChangedAt,
    opts.channel,
    id
  );
}

/** An entry with its first event (the origin bySource buckets by). */
function entry(ws: string, id: string, stage: string, channel: string | null) {
  const { entry: e } = createPipelineEntry({
    candidateId: id,
    candidateLabel: id,
    jobId: `${ws}-job`,
    jobTitle: "Backend Engineer",
    stage,
    sourceChannel: channel ?? undefined,
    workspaceId: ws,
  });
  const has = ensureDb().prepare(`SELECT COUNT(*) AS n FROM pipeline_events WHERE entry_id = ?`).get(e.id) as { n: number };
  if (has.n === 0) {
    ensureDb()
      .prepare(`INSERT INTO pipeline_events (entry_id, candidate_label, job_title, kind, created_at, workspace_id) VALUES (?, ?, 'Backend Engineer', 'applied', ?, ?)`)
      .run(e.id, id, new Date().toISOString(), ws);
  }
  return e;
}

/** Project the full battery's payload onto exactly the slim slice's shape. */
function project(a: PipelineAnalytics) {
  return {
    total: a.total,
    hired: a.hired,
    // The cohort cap must cut the two reads the SAME way, or a delta would compare
    // a whole window against a slice of another — so the flag is part of the identity.
    truncated: a.truncated,
    avgTimeToHireDays: a.avgTimeToHireDays,
    timeToHireSamples: a.timeToHireSamples,
    funnel: a.funnel.map((f) => ({ stage: f.stage, reached: f.reached, conversionPct: f.conversionPct })),
    bySource: a.bySource.map((r) => ({ source: r.source, total: r.total, hireRatePct: r.hireRatePct })),
    byChannel: a.byChannel.map((r) => ({
      channel: r.channel,
      total: r.total,
      hireRatePct: r.hireRatePct,
      costPerApplicantCzk: r.costPerApplicantCzk,
    })),
  };
}

test("pipelineAnalyticsPrior matches the full battery's compared scalars over the prior window", () => {
  const WS = "ps-identity-ws";
  const windowDays = 30;
  const endMs = Date.now() - 10 * DAY;

  place(entry(WS, "ps-a", "Hired", "apply").id, { createdDaysAgo: 20, channel: "apply", hiredDaysAgo: 12 });
  place(entry(WS, "ps-b", "Screened", "boards").id, { createdDaysAgo: 35, channel: "boards" });
  place(entry(WS, "ps-c", "Interview", "apply").id, { createdDaysAgo: 5, channel: "apply" });
  place(entry(WS, "ps-d", "Screened", "rediscovery").id, { createdDaysAgo: 50, channel: "rediscovery" });

  const full = pipelineAnalytics(windowDays, { endMs }, WS);
  const slim = pipelineAnalyticsPrior(windowDays, endMs, WS);

  assert.deepEqual(slim, project(full), "slim prior slice diverged from the full battery's compared fields");
  // Guard the test is actually exercising a non-empty cohort (not vacuously equal).
  assert.equal(full.total, 2, "a and b are in [now-40d, now-10d); c is after it, d before it");
  assert.ok(full.bySource.length >= 1, "expected at least one first-touch origin bucket");
  // BOTH reads now stop at the window end — the entry created 5 days ago is in neither.
  assert.equal(
    slim.bySource.reduce((s, r) => s + r.total, 0),
    2,
    "the prior window's source read counts its own cohort, never a later candidate"
  );
});

test("the prior source read is BOUNDED: a current-window entry contributes 0 to it", () => {
  const WS = "ps-bound-ws";
  const now = Date.now();
  const w = deltaWindows(now, 30);
  // One candidate inside the prior window, one 5 days ago (inside the CURRENT window).
  place(entry(WS, "pb-prior", "Screened", "apply").id, { createdDaysAgo: 45, channel: "apply", now });
  place(entry(WS, "pb-current", "Interview", "apply").id, { createdDaysAgo: 5, channel: "apply", now });

  const prior = pipelineAnalyticsPrior(30, w.prior.endExclusive, WS);
  assert.equal(prior.total, 1);
  assert.equal(
    prior.bySource.reduce((s, r) => s + r.total, 0),
    1,
    "the entry created 5 days ago leaked into the PRIOR window's per-source volume"
  );
});

test("an entry created exactly at the current window's start is current, and in neither prior read", () => {
  const WS = "ps-edge-ws";
  const now = Date.now();
  const w = deltaWindows(now, 30);
  place(entry(WS, "pe-edge", "Screened", "apply").id, { createdDaysAgo: 0, createdAtMs: w.current.start, channel: "apply", now });

  const current = pipelineAnalytics(30, { nowMs: now }, WS);
  const prior = pipelineAnalyticsPrior(30, w.prior.endExclusive, WS);
  assert.equal(current.total, 1, "the boundary instant belongs to the window it starts");
  assert.equal(prior.total, 0, "and not to the one it ends");
  assert.equal(prior.bySource.reduce((s, r) => s + r.total, 0), 0);
  assert.equal(prior.byChannel.reduce((s, r) => s + r.total, 0), 0);
});

test("the prior cohort is judged AS OF its own end: a later hire is not a prior-window hire", () => {
  const WS = "ps-asof-ws";
  const now = Date.now();
  const w = deltaWindows(now, 30);
  // Created 40 days ago, hired 20 days ago — after the prior window closed at now-30d.
  place(entry(WS, "pa-late", "Hired", "apply").id, { createdDaysAgo: 40, hiredDaysAgo: 20, channel: "apply", now });
  // Created 45 days ago, hired 35 days ago — inside the prior window.
  place(entry(WS, "pa-early", "Hired", "apply").id, { createdDaysAgo: 45, hiredDaysAgo: 35, channel: "apply", now });

  const prior = pipelineAnalyticsPrior(30, w.prior.endExclusive, WS);
  assert.equal(prior.total, 2);
  assert.equal(prior.hired, 1, "only the hire that landed before the window end counts");
  assert.equal(prior.timeToHireSamples, 1, "the late hire is excluded from the prior time-to-hire sample");
  assert.equal(prior.avgTimeToHireDays, 10);
  // Both entries share one origin bucket (whatever first event the board wrote).
  assert.deepEqual(
    prior.bySource.map((s) => [s.total, s.hireRatePct]),
    [[2, 50]]
  );
  assert.equal(prior.byChannel.find((c) => c.channel === "apply")?.hireRatePct, 50);
});

test("the prior slice names its n: funnel reach and the time-to-hire sample ride with it", () => {
  const WS = "ps-n-ws";
  const now = Date.now();
  const w = deltaWindows(now, 30);
  place(entry(WS, "pn-1", "Interview", "apply").id, { createdDaysAgo: 40, channel: "apply", now });
  place(entry(WS, "pn-2", "Screened", "apply").id, { createdDaysAgo: 41, channel: "apply", now });
  place(entry(WS, "pn-3", "Hired", "apply").id, { createdDaysAgo: 50, hiredDaysAgo: 40, channel: "apply", now });

  const prior = pipelineAnalyticsPrior(30, w.prior.endExclusive, WS);
  assert.deepEqual(
    prior.funnel.map((f) => [f.stage, f.reached]),
    [
      ["Accepted", 3],
      ["Screened", 3],
      ["Interview", 2],
      ["Offer", 1],
      ["Hired", 1],
    ]
  );
  assert.equal(prior.timeToHireSamples, 1);
});

test("the live payload IS foldCohort over the rows it reads, as of its own clock", () => {
  const WS = "ps-live-ws";
  const now = Date.now();
  place(entry(WS, "pl-1", "Hired", "apply").id, { createdDaysAgo: 20, hiredDaysAgo: 4, channel: "apply", now });
  place(entry(WS, "pl-2", "Hired", "boards").id, { createdDaysAgo: 28, hiredDaysAgo: 2, channel: "boards", now });
  place(entry(WS, "pl-3", "Interview", "apply").id, { createdDaysAgo: 10, channel: "apply", now });
  place(entry(WS, "pl-4", "Screened", null).id, { createdDaysAgo: 3, channel: null, now });
  place(entry(WS, "pl-5", "Offer", "apply").id, { createdDaysAgo: 45, channel: "apply", now });

  const live = pipelineAnalytics(30, { nowMs: now }, WS);
  const cutoff = new Date(deltaWindows(now, 30).current.start).toISOString();
  const rows = ensureDb()
    .prepare(
      `SELECT stage, status, created_at, stage_changed_at, source_channel FROM pipeline_entries
        WHERE created_at >= ? AND workspace_id = ? ORDER BY created_at DESC`
    )
    .all(cutoff, WS) as CohortRow[];
  const fold = foldCohort(rows, getPipelineAxis(WS).stages, { asOfMs: now });

  assert.equal(fold.total, live.total);
  assert.equal(fold.total, 4);
  assert.equal(fold.hired, live.hired);
  assert.deepEqual(
    fold.funnel.map((f) => ({ stage: f.stage, reached: f.reached, conversionPct: f.conversionPct })),
    live.funnel.map((f) => ({ stage: f.stage, reached: f.reached, conversionPct: f.conversionPct }))
  );
  assert.equal(fold.avgTimeToHireDays, live.avgTimeToHireDays);
  assert.equal(fold.timeToHireSamples, live.timeToHireSamples);
  assert.equal(fold.timeToHireSamples, 2);
});
