// P5 proof: the analytics funnel follows the WORKSPACE's board, not the shipped
// five names.
//
// This is the failure the whole role layer exists to prevent, and it is the kind
// that ships quietly: before this pass, `pipelineAnalytics` indexed the canonical
// stage list, so a team that renamed a column got a funnel whose rows nobody
// recognised AND whose candidates were silently dropped (`idxOf === -1` skips the
// row entirely). Nothing threw; the numbers were just wrong.
//
// Runs against an ISOLATED throwaway DB (testing/unit-db.ts must stay the first
// project import).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { setDecisionConfig } from "../decision-config-store.ts";
import { PIPELINE_STAGES_DEFAULT } from "../decision-config-schema.ts";
import { pipelineAnalytics } from "./analytics.ts";
import { createPipelineEntry, setPipelineEntryStage } from "./pipeline.ts";
import { ensureDb } from "./core.ts";

after(() => cleanupUnitDb());

const WS = "workspace";

/** A board this workspace invented: every column renamed, plus a second
 *  interview round the shipped axis cannot express. */
const CUSTOM = {
  stages: [
    { id: "Applied", label: "Applied", role: "entry" as const },
    { id: "Triage", label: "Triage", role: "screening" as const },
    { id: "Tech screen", label: "Tech screen", role: "interview" as const },
    { id: "Onsite", label: "Onsite", role: "interview" as const },
    { id: "Package", label: "Package", role: "offer" as const },
    { id: "Signed", label: "Signed", role: "terminal" as const },
  ],
  retired: [],
};

let seq = 0;
function entryAt(stage: string): string {
  seq += 1;
  const { entry } = createPipelineEntry({
    candidateId: `ax-c${seq}`,
    candidateLabel: `Axis Candidate ${seq}`,
    jobId: "ax-job",
    jobTitle: "Axis Role",
  });
  setPipelineEntryStage(entry.id, stage);
  return entry.id;
}

test("the funnel reports the SHIPPED columns for a workspace with no override", () => {
  const funnel = pipelineAnalytics(null, undefined, WS).funnel.map((f) => f.stage);
  assert.deepEqual(funnel, ["Accepted", "Screened", "Interview", "Offer", "Hired"]);
});

test("after a board edit the funnel reports THAT board's columns, in its order", () => {
  setDecisionConfig("pipelineStages", CUSTOM as unknown as Record<string, unknown>, WS, "team");
  const funnel = pipelineAnalytics(null, undefined, WS).funnel.map((f) => f.stage);
  assert.deepEqual(funnel, ["Applied", "Triage", "Tech screen", "Onsite", "Package", "Signed"]);
});

test("candidates on renamed columns are COUNTED, not silently dropped", () => {
  const before = pipelineAnalytics(null, undefined, WS);
  entryAt("Onsite");
  entryAt("Onsite");
  const after = pipelineAnalytics(null, undefined, WS);

  const onsite = (a: typeof after) => a.funnel.find((f) => f.stage === "Onsite")!;
  assert.equal(onsite(after).current - onsite(before).current, 2, "both land in their own column");
  // "Reached" is cumulative down the funnel, so they also count toward every
  // earlier column — the property the old name-indexed version lost entirely.
  assert.equal(after.funnel[0].reached - before.funnel[0].reached, 2);
});

test("'hired' and 'active' follow the TERMINAL role, not the name Hired", () => {
  const before = pipelineAnalytics(null, undefined, WS);
  entryAt("Signed");
  const after = pipelineAnalytics(null, undefined, WS);

  assert.equal(after.hired - before.hired, 1, "a candidate on the renamed terminal column is a hire");
  assert.equal(after.active - before.active, 0, "and is NOT counted as still active");
});

test("'reached interview' follows the first INTERVIEW-role column", () => {
  const before = pipelineAnalytics(null, undefined, WS).byJob.find((j) => j.jobTitle === "Axis Role");
  entryAt("Tech screen"); // the FIRST interview round on this axis
  entryAt("Triage"); // screening — must NOT count
  const after = pipelineAnalytics(null, undefined, WS).byJob.find((j) => j.jobTitle === "Axis Role")!;

  assert.equal(after.reachedInterview - (before?.reachedInterview ?? 0), 1);
  assert.equal(after.total - (before?.total ?? 0), 2, "both candidates are in the cohort");
});

// ---------------------------------------------------------------------------
// The two OTHER metrics on the page that carry a stage threshold. The funnel was
// fixed to read the workspace axis; these two kept resolving stage meaning from
// the shipped default, which on an invented board means "no stage matches".
// Pinned on their OWN workspace so the assertions are absolute counts rather
// than deltas against the unit DB's demo seed.
// ---------------------------------------------------------------------------
const METRICS_WS = "axis-metrics-ws";

test("setup — a second workspace running the same invented board", () => {
  setDecisionConfig("pipelineStages", CUSTOM as unknown as Record<string, unknown>, METRICS_WS, "team");
  // Two candidates past THIS board's screening gate ("Tech screen" is its first
  // interview-role column), one still in screening.
  ["Tech screen", "Onsite", "Triage"].forEach((stage, i) =>
    createPipelineEntry({
      candidateId: `am-c${i}`,
      candidateLabel: `AM ${i}`,
      jobId: "am-job",
      jobTitle: "AM Role",
      stage,
      workspaceId: METRICS_WS,
    })
  );
});

test("the archetype-fairness metric reads THIS board's screening gate", () => {
  const a = pipelineAnalytics(null, undefined, METRICS_WS);
  const bau = a.byArchetype.find((x) => x.archetype === "bau");
  assert.ok(bau, "the cohort has an archetype row");
  assert.equal(bau.total, 3);
  // Resolved against the SHIPPED axis instead, every renamed column indexes to
  // -1, so the equity headline read a flat 0% for the entire board.
  assert.equal(bau.advanceRatePct, 67, "2 of 3 cleared the gate");
  // …and it must agree with byJob's reachedInterview, which analytics.ts states
  // is the same threshold over the same cohort.
  const job = a.byJob.find((j) => j.jobTitle === "AM Role");
  assert.equal(job?.reachedInterview, 2, "the two funnel thresholds must never disagree for one cohort");
});

test("the momentum chart's hire series follows the TERMINAL role, not the name Hired", () => {
  const { entry } = createPipelineEntry({
    candidateId: "am-hire",
    candidateLabel: "AM Hire",
    jobId: "am-job",
    jobTitle: "AM Role",
    stage: "Signed",
    workspaceId: METRICS_WS,
  });
  // The terminal transition as the real board writes it (kind 'advanced' onto the
  // final column) — the row weeklyMomentum classifies into `hired` vs `advanced`.
  ensureDb()
    .prepare(
      `INSERT INTO pipeline_events (entry_id, candidate_label, job_title, kind, from_stage, to_stage, created_at, workspace_id)
       VALUES (?, 'AM Hire', 'AM Role', 'advanced', 'Package', 'Signed', ?, ?)`
    )
    .run(entry.id, new Date(Date.now() - 2 * 86_400_000).toISOString(), METRICS_WS);

  const weeks = pipelineAnalytics(null, undefined, METRICS_WS).momentum;
  const sum = (k: "hired" | "advanced") => weeks.reduce((s, w) => s + w[k], 0);
  assert.equal(sum("hired"), 1, "a transition onto the renamed terminal column IS a hire");
  assert.equal(sum("advanced"), 0, "…and must not be miscounted as an ordinary advance");
});

test("restoring the shipped axis restores the shipped funnel", () => {
  setDecisionConfig("pipelineStages", PIPELINE_STAGES_DEFAULT as unknown as Record<string, unknown>, WS, "team");
  const funnel = pipelineAnalytics(null, undefined, WS).funnel.map((f) => f.stage);
  assert.deepEqual(funnel, ["Accepted", "Screened", "Interview", "Offer", "Hired"]);
});
