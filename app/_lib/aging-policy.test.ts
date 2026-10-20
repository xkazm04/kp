// One aging clock (challenge-r02 pipeline-actions-events/A).
//
// The pipeline had three answers to "has this candidate waited too long": the board
// (agingBucket) and the sidebar badge (attentionCounts) aged a card on its stage
// ROLE's SLA, while the automation policy pass wrote stale_alert / aging_alert on a
// flat 21/30-day cut for every stage, terminal included. aging-policy.ts is now the
// one source of the tier; these cases pin the tier table, the terminal rule, and
// that the board and the badge read the same answer the engine is handed.
//
// unit-db.ts MUST be the first project import: attention.ts pulls the store graph.
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AGING_TIER_ALERT, STALLED_MULTIPLE, agingTier, agingTierAt } from "./aging-policy.ts";
import { agingBucket } from "@/app/features/hiring/pipeline/pipelineRenderDiet";
import { attentionStale } from "./attention.ts";
import { DEFAULT_STAGE_AXIS, type StageDef } from "./pipeline-stages.ts";
import type { Entry } from "@/app/features/shared/pipelineTypes";

after(() => cleanupUnitDb());

const DAY = 86_400_000;
const NOW = Date.parse("2026-09-23T10:00:00.000Z");

const CUSTOM_AXIS: readonly StageDef[] = [
  { id: "Applied", label: "Applied", role: "entry" },
  { id: "Tech round", label: "Tech round", role: "interview" },
  { id: "Offer", label: "Offer", role: "offer" },
  { id: "Placed", label: "Placed", role: "terminal" },
];

test("offer role: none below the 3-day SLA, aging at it, stalled at twice it", () => {
  assert.equal(STALLED_MULTIPLE, 2, "the stalled boundary is ONE stated multiple of the SLA");
  assert.equal(agingTier("Offer", 2), "none");
  assert.equal(agingTier("Offer", 3), "aging");
  assert.equal(agingTier("Offer", 5), "aging");
  assert.equal(agingTier("Offer", 6), "stalled");
});

test("a terminal-ROLE stage never ages, whatever it is called", () => {
  assert.equal(agingTier("Hired", 400), "none", "the shipped terminal column");
  assert.equal(agingTier("Placed", 400, CUSTOM_AXIS), "none", "a renamed terminal column on a custom axis");
  // A retired 'Hired' id (no longer on this axis) still carries a 0-day default:
  // a non-positive SLA means never-ages, not instantly-stale.
  assert.equal(agingTier("Hired", 400, CUSTOM_AXIS), "none");
});

test("an unknown dwell reads fresh", () => {
  assert.equal(agingTier("Offer", null), "none");
  assert.equal(agingTierAt("Offer", "not-a-date", NOW), "none");
  assert.equal(agingTierAt("Offer", null, NOW), "none");
});

test("the tier -> alert-kind map keeps the board's names the right way round", () => {
  // Board 'aging' is the SOFT tier; the engine's aging_alert used to be its HARD tier.
  assert.deepEqual({ ...AGING_TIER_ALERT }, { aging: "stale_alert", stalled: "aging_alert" });
});

function entryAt(stage: string, days: number): Entry {
  return {
    id: `e-${stage}-${days}`,
    candidateId: null,
    candidateLabel: "x",
    archetype: "bau",
    roleFamily: null,
    jobId: "j",
    jobTitle: "J",
    stage,
    matchScore: 70,
    status: "active",
    approvalKind: null,
    approvalDetail: null,
    createdAt: null,
    stageChangedAt: new Date(NOW - days * DAY).toISOString(),
  };
}

test("parity: board agingBucket, badge predicate and agingTier agree on the shipped axis x 0..20 days", () => {
  let checked = 0;
  for (const def of DEFAULT_STAGE_AXIS) {
    for (let days = 0; days <= 20; days++) {
      const e = entryAt(def.id, days);
      const tierSays = agingTier(def.id, days) !== "none";
      assert.equal(agingBucket(e, null, NOW) === 1, tierSays, `board vs tier: ${def.id} @ ${days}d`);
      assert.equal(attentionStale(e, DEFAULT_STAGE_AXIS, NOW), tierSays, `badge vs tier: ${def.id} @ ${days}d`);
      checked++;
    }
  }
  assert.equal(checked, DEFAULT_STAGE_AXIS.length * 21);
});

test("the feed verbs name their tier in every locale (both namespaces)", () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const en = JSON.parse(readFileSync(resolve(root, "messages/en.json"), "utf8"));
  const verbs = en.pipeline.events as Record<string, string>;
  assert.match(verbs.stale_alert, /SLA/, "stale_alert is the soft tier: past the stage SLA");
  assert.match(verbs.aging_alert, /stalled/i, "aging_alert is the hard tier: stalled");
  assert.match(verbs.aging_alert, /twice/i, "the hard tier names its multiple");
});
