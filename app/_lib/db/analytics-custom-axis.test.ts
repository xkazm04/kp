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

test("restoring the shipped axis restores the shipped funnel", () => {
  setDecisionConfig("pipelineStages", PIPELINE_STAGES_DEFAULT as unknown as Record<string, unknown>, WS, "team");
  const funnel = pipelineAnalytics(null, undefined, WS).funnel.map((f) => f.stage);
  assert.deepEqual(funnel, ["Accepted", "Screened", "Interview", "Offer", "Hired"]);
});
