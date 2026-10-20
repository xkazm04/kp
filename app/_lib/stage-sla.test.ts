// Stage aging SLAs are TEAM data on the board axis (challenge-r03 pipeline-board-ui/A).
//
// The cadence a board ages against used to be a per-BROWSER localStorage map
// (`kp.pipelineStageSla:<ws>`), so two recruiters on one team aged the same board
// differently, and the sidebar badge + the automation pass (server-side, no browser)
// silently used role defaults and contradicted the board's chip the moment anyone
// tuned a column. The cadence now lives on the workspace's `pipelineStages` axis as an
// optional `slaDays` per stage, and every surface resolves it through the ONE aging
// clock (aging-policy.ts `slaForStage`).
//
// What is pinned here:
//   1. the schema accepts it (integer 1..365, never on the terminal role),
//   2. it survives the axis resolver AND a Settings -> Hiring composer save round-trip,
//   3. slaForStage layers it between the board override and the role default,
//   4. the sidebar badge (attentionCounts) and the automation pass input follow it
//      with no edit to attention.ts,
//   5. the pure adoption helpers the board's one-time localStorage migration uses.
//
// unit-db.ts must stay the first project import (isolated throwaway DB).
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateDecisionConfig, type PipelineStagesRule } from "./decision-config-schema.ts";
import { resolveStageAxis } from "./pipeline-axis.ts";
import { DEFAULT_STAGE_AXIS, type StageDef } from "./pipeline-stages.ts";
import { ROLE_SLA_DEFAULTS, agingTier, slaForStage } from "./aging-policy.ts";
import { applyStageSla, pendingLocalAdoption, slaOverridesFromAxis } from "./stage-sla.ts";
import { draftFromStored, draftToStored, setStageRole } from "../features/shared/pipelineAxisDraft.ts";
import { attentionCounts } from "./attention.ts";
import { createPipelineEntry, listActiveEntriesForAutomation } from "./db/pipeline.ts";
import { ensureDb } from "./db/core.ts";
import { setDecisionConfig } from "./decision-config-store.ts";

after(() => cleanupUnitDb());

const shipped = (): PipelineStagesRule => ({
  stages: DEFAULT_STAGE_AXIS.map((s) => ({ id: s.id, label: s.label, role: s.role as PipelineStagesRule["stages"][number]["role"] })),
  retired: [],
});
const withSla = (id: string, slaDays: unknown): Record<string, unknown> => {
  const r = shipped() as unknown as { stages: Record<string, unknown>[]; retired: unknown[] };
  return { ...r, stages: r.stages.map((s) => (s.id === id ? { ...s, slaDays } : s)) };
};

// ---- 1. schema --------------------------------------------------------------

test("the axis schema accepts an integer slaDays in 1..365 and keeps it", () => {
  const res = validateDecisionConfig("pipelineStages", withSla("Screened", 9));
  assert.equal(res.ok, true);
  if (!res.ok || res.phase !== "pipelineStages") return;
  assert.equal(res.config.stages.find((s) => s.id === "Screened")?.slaDays, 9);
  // A stage without it stores no key at all (absent = role default).
  assert.equal("slaDays" in res.config.stages.find((s) => s.id === "Interview")!, false);
});

test("the axis schema refuses slaDays that is 0, over 365, fractional or a string", () => {
  for (const bad of [0, 400, 2.5, "7", -3, Number.NaN]) {
    assert.equal(validateDecisionConfig("pipelineStages", withSla("Screened", bad)).ok, false, `slaDays ${String(bad)}`);
  }
});

test("the axis schema refuses slaDays on the terminal stage: a hired candidate has no clock", () => {
  assert.equal(validateDecisionConfig("pipelineStages", withSla("Hired", 5)).ok, false);
});

// ---- 2. resolver + composer round-trip ---------------------------------------

test("resolveStageAxis carries slaDays onto the StageDef, and a composer save keeps it", () => {
  const res = validateDecisionConfig("pipelineStages", withSla("Screened", 9));
  assert.ok(res.ok && res.phase === "pipelineStages");
  const rule = (res as { config: PipelineStagesRule }).config;
  const axis = resolveStageAxis(rule);
  assert.equal(axis.stages.find((s) => s.id === "Screened")?.slaDays, 9);
  // Settings -> Hiring builds its save from draftToStored(draftFromStored(rule)). A
  // wire() that copied only id/label/role/actions erased every team cadence on save.
  const saved = draftToStored(draftFromStored(rule), axis.stages);
  assert.equal(saved.stages.find((s) => s.id === "Screened")?.slaDays, 9);
  assert.equal(validateDecisionConfig("pipelineStages", saved).ok, true, "the round-tripped axis is still valid");
});

test("the composer drops a cadence when a column is turned into the terminal one", () => {
  const rule = (validateDecisionConfig("pipelineStages", withSla("Offer", 4)) as { config: PipelineStagesRule }).config;
  const draft = setStageRole(draftFromStored(rule), "Offer", "terminal");
  assert.equal("slaDays" in draft.stages.find((s) => s.id === "Offer")!, false);
});

// ---- 3. the one aging clock -------------------------------------------------

const axisWith = (id: string, slaDays: number): StageDef[] =>
  DEFAULT_STAGE_AXIS.map((s) => (s.id === id ? { ...s, slaDays } : { ...s }));

test("slaForStage reads the team's axis value between the board override and the role default", () => {
  assert.equal(slaForStage("Interview", undefined, axisWith("Interview", 2)), 2);
  assert.equal(slaForStage("Interview", undefined, DEFAULT_STAGE_AXIS), ROLE_SLA_DEFAULTS.interview);
  assert.equal(slaForStage("Interview", { Interview: 11 }, axisWith("Interview", 2)), 11, "an explicit override still wins");
  assert.equal(agingTier("Interview", 2, axisWith("Interview", 2)), "aging", "the tier follows the team value");
  assert.equal(agingTier("Interview", 4, axisWith("Interview", 2)), "stalled");
});

// ---- 4. the badge and the automation pass follow it --------------------------

const ago = (days: number) => new Date(Date.now() - days * 86_400_000 - 3_600_000).toISOString();
let seq = 0;
function entryIn(workspaceId: string, stage: string, daysAgo: number): string {
  seq += 1;
  const { entry } = createPipelineEntry({
    candidateId: `sla-c${seq}`,
    candidateLabel: `Sla Candidate ${seq}`,
    jobId: `sla-job-${seq}`,
    jobTitle: "Sla Test Role",
    contact: `sla-c${seq}@example.com`,
    stage,
    workspaceId,
  });
  ensureDb().prepare(`UPDATE pipeline_entries SET stage_changed_at = ? WHERE id = ?`).run(ago(daysAgo), entry.id);
  return entry.id;
}

test("attentionCounts ages on the team's slaDays; an identical entry on a team without one does not", () => {
  const WS_TUNED = "team-sla-tuned";
  const WS_PLAIN = "team-sla-plain";
  setDecisionConfig("pipelineStages", withSla("Screened", 2), WS_TUNED, "team");
  const tunedBefore = attentionCounts(WS_TUNED).pipeline;
  const plainBefore = attentionCounts(WS_PLAIN).pipeline;
  entryIn(WS_TUNED, "Screened", 3);
  entryIn(WS_PLAIN, "Screened", 3);
  assert.equal(attentionCounts(WS_TUNED).pipeline, tunedBefore + 1, "3 days past a 2-day team SLA is aging");
  assert.equal(attentionCounts(WS_PLAIN).pipeline, plainBefore, "3 days in screening is inside the 7-day role default");
});

test("the automation pass input stamps the tier from the team's slaDays", () => {
  const WS_AUTO = "team-sla-auto";
  setDecisionConfig("pipelineStages", withSla("Screened", 2), WS_AUTO, "team");
  const id = entryIn(WS_AUTO, "Screened", 3);
  const row = listActiveEntriesForAutomation().find((r) => r.id === id);
  assert.equal(row?.agingTier, "aging");
});

test("attention.ts carries no SLA code of its own: it inherits the team value through the clock", () => {
  const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "attention.ts"), "utf8");
  assert.equal(/slaDays|slaForStage/.test(src.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, "")), false);
});

// ---- 5. the single-column writer and the adoption helpers --------------------

test("applyStageSla sets one stage's cadence and leaves everything else byte-identical", () => {
  const before = { ...shipped(), retired: [{ id: "Old", label: "Old", role: "custom" as const }] };
  const res = applyStageSla(before, "Screened", 3);
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(res.rule.stages.find((s) => s.id === "Screened")?.slaDays, 3);
  const strip = (r: PipelineStagesRule) =>
    JSON.stringify({
      ...r,
      stages: r.stages.map((s) => {
        const copy = { ...s };
        delete copy.slaDays;
        return copy;
      }),
    });
  assert.equal(strip(res.rule), strip(before));
  const cleared = applyStageSla(res.rule, "Screened", null);
  assert.ok(cleared.ok);
  assert.equal("slaDays" in (cleared as { rule: PipelineStagesRule }).rule.stages.find((s) => s.id === "Screened")!, false);
  assert.equal(JSON.stringify((cleared as { rule: PipelineStagesRule }).rule), JSON.stringify(before), "clearing removes the key");
});

test("applyStageSla refuses an off-axis stage, the terminal stage and an out-of-range value", () => {
  assert.equal(applyStageSla(shipped(), "Nowhere", 3).ok, false);
  assert.equal(applyStageSla({ ...shipped(), retired: [{ id: "Old", label: "Old", role: "custom" }] }, "Old", 3).ok, false, "a retired column is not on the live axis");
  assert.equal(applyStageSla(shipped(), "Hired", 3).ok, false);
  for (const bad of [0, 366, 1.5, "3" as unknown as number]) assert.equal(applyStageSla(shipped(), "Screened", bad).ok, false);
});

test("slaOverridesFromAxis and pendingLocalAdoption: offer a leftover browser cadence once, only where it differs", () => {
  const axis = axisWith("Screened", 3);
  assert.deepEqual(slaOverridesFromAxis(axis), { Screened: 3 });
  assert.deepEqual(pendingLocalAdoption({ Screened: 4, Gone: 9 }, axis), [{ stage: "Screened", days: 4 }]);
  assert.deepEqual(pendingLocalAdoption({ Screened: 3 }, axis), [], "a value equal to the team's is not offered");
  assert.deepEqual(pendingLocalAdoption({ Hired: 4 }, axis), [], "the terminal column has no clock to adopt");
  assert.deepEqual(pendingLocalAdoption({ Interview: 5000 }, axis), [], "an out-of-range leftover is not offered as team policy");
});
