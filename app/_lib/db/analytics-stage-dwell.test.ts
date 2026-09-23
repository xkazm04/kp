// The dwell band describes everyone waiting NOW, judged by the one aging clock
// (challenge-r05 analytics-metrics/B).
//
// Before: stageDwell and the funnel band's bottleneck were folded from the window's
// CREATION COHORT, so a 30-day view dropped every active candidate created before the
// window — exactly the longest waiters — while the claim above the rows said "waiting
// in a stage right now". It printed a rounded mean, and it aged nobody against the
// cadence the board, the sidebar badge and the automation pass already share.
//
// Runs against an ISOLATED throwaway DB (testing/unit-db.ts must stay the first
// project import). One workspace per case so the fixtures cannot bleed.
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { pipelineAnalytics } from "./analytics.ts";
import { createPipelineEntry } from "./pipeline.ts";
import { ensureDb } from "./core.ts";
import { setDecisionConfig } from "../decision-config-store.ts";
import { PIPELINE_STAGES_DEFAULT } from "../decision-config-schema.ts";
import { applyStageSla } from "../stage-sla.ts";
import { agingTierAt } from "../aging-policy.ts";
import { DEFAULT_STAGE_AXIS } from "../pipeline-stages.ts";

after(() => cleanupUnitDb());

const DAY = 86_400_000;
const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * DAY).toISOString();
let seq = 0;

/** An active entry created `createdDaysAgo`, standing in `stage` since `inStageDaysAgo`.
 *  Half-day offsets keep every fixture clear of a whole-day boundary. */
function occupant(ws: string, stage: string, createdDaysAgo: number, inStageDaysAgo: number, jobId = "dwell-job"): string {
  seq += 1;
  const { entry } = createPipelineEntry({
    candidateId: `dwell-c${seq}`,
    candidateLabel: `Dwell Candidate ${seq}`,
    jobId,
    jobTitle: "Dwell Role",
    stage,
    workspaceId: ws,
  });
  ensureDb()
    .prepare(`UPDATE pipeline_entries SET created_at = ?, stage_changed_at = ? WHERE id = ?`)
    .run(iso(createdDaysAgo), iso(inStageDaysAgo), entry.id);
  return entry.id;
}

const row = (ws: string, stage: string, windowDays: number | null = null, jobId?: string) =>
  pipelineAnalytics(windowDays, jobId ? { jobId } : undefined, ws).stageDwell.find((s) => s.stage === stage);

test("as-of-now, not cohort: a long waiter created before the window is still counted", () => {
  const ws = "dwell-now";
  occupant(ws, "Screened", 60, 20.5);
  occupant(ws, "Accepted", 5, 5.5);
  const windowed = row(ws, "Screened", 30);
  assert.ok(windowed, "the Screened waiter created 60 days ago must not vanish from a 30-day view");
  assert.equal(windowed.count, 1);
  assert.equal(windowed.oldestDays, 20);
  assert.deepEqual(row(ws, "Screened", null), windowed, "the waiting-now figure does not depend on the window");
});

test("one aging clock: 6 whole days in Interview on the default axis is past the 5-day default", () => {
  const ws = "dwell-default";
  occupant(ws, "Interview", 8, 6.5);
  const r = row(ws, "Interview")!;
  assert.equal(r.count, 1);
  assert.equal(r.pastCadence, 1);
  assert.equal(r.stalled, 0);
  assert.equal(r.cadenceDays, 5);
  assert.equal(r.cadenceSource, "default");
  assert.equal(agingTierAt("Interview", iso(6.5), Date.now(), DEFAULT_STAGE_AXIS), "aging", "the board's own predicate agrees");
});

test("team cadence: a team-set 10 days clears the same wait; stalled counts inside pastCadence", () => {
  const ws = "dwell-team";
  const res = applyStageSla(PIPELINE_STAGES_DEFAULT, "Interview", 10);
  assert.ok(res.ok);
  setDecisionConfig("pipelineStages", res.rule as unknown as Record<string, unknown>, ws, "team");
  occupant(ws, "Interview", 8, 6.5);
  occupant(ws, "Offer", 9, 7.5);
  const interview = row(ws, "Interview")!;
  assert.equal(interview.pastCadence, 0);
  assert.equal(interview.cadenceDays, 10);
  assert.equal(interview.cadenceSource, "team");
  const offer = row(ws, "Offer")!;
  assert.equal(offer.cadenceDays, 3, "Offer keeps its role default of 3 days");
  assert.equal(offer.stalled, 1, "7 days is past 2 x 3");
  assert.equal(offer.pastCadence, 1, "pastCadence is every tier past none (aging + stalled), the board's ?quick=aging set");
});

test("pair, not a mean: occupants at 2, 3 and 31 days give median 3 and oldest 31", () => {
  const ws = "dwell-pair";
  occupant(ws, "Screened", 3, 2.5);
  occupant(ws, "Screened", 4, 3.5);
  occupant(ws, "Screened", 40, 31.5);
  const r = row(ws, "Screened")!;
  assert.equal(r.count, 3);
  assert.equal(r.medianDays, 3);
  assert.equal(r.oldestDays, 31);
  assert.equal(r.avgDays, 12, "the mean is kept for older readers, and it is the figure that hid the 31");
});

test("the job and sim predicates still scope the waiting-now read", () => {
  const ws = "dwell-scope";
  occupant(ws, "Screened", 50, 10.5, "dwell-a");
  occupant(ws, "Screened", 50, 10.5, "dwell-b");
  assert.equal(row(ws, "Screened")!.count, 2);
  assert.equal(row(ws, "Screened", 30, "dwell-a")!.count, 1, "a role-scoped read counts that role's waiters only");
  const simId = occupant(ws, "Screened", 50, 10.5);
  ensureDb().prepare(`UPDATE pipeline_entries SET job_title = ? WHERE id = ?`).run("Guided demo (SIM)", simId);
  assert.equal(row(ws, "Screened")!.count, 2, "guided-demo residue never counts as a waiter");
});

test("the bottleneck behind the band's 'stalled' claim is picked from the same occupants", () => {
  const ws = "dwell-bottleneck";
  occupant(ws, "Interview", 70, 40.5);
  occupant(ws, "Interview", 70, 41.5);
  occupant(ws, "Interview", 70, 42.5);
  occupant(ws, "Accepted", 2, 1.5);
  const a = pipelineAnalytics(30, undefined, ws);
  assert.ok(a.bottleneck, "three people 40+ days in Interview are a bottleneck even though none was created in the window");
  assert.equal(a.bottleneck.stage, "Interview");
  const dwell = a.stageDwell.find((s) => s.stage === "Interview")!;
  assert.equal(a.bottleneck.entryCount, dwell.count, "the band and the rows under it count the same people");
});
