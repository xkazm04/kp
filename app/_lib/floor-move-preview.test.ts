// Before Apply, who on today's board does the floor move? — challenge-r08
// cv-analysis-archetypes/B. The preview is the screening wave's OWN dry run, run
// twice per role (the saved rule, then the rule with the suggested floor), and a
// pure diff of the two decision lists. So:
//   - the pure diff buckets, groups per role, caps names and deep-links them;
//   - a fairness-protected candidate the move would reach is SHIELDED, never entering;
//   - a family-scoped preview merges the suggested family floor INTO the saved map
//     (validateScreeningOverride replaces familyFloors wholesale, so an unmerged
//     override would silently drop every other family's floor from the "after" rule);
//   - auto-reject off -> nothing is in reach, stated rather than counted;
//   - and a preview WRITES NOTHING: no pipeline row, event, sealed record or config.
//
// unit-db.ts must stay the first project import (isolated throwaway DB).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { createPipelineEntry, listPipeline, listPipelineEvents } from "./db/pipeline.ts";
import { createWorkspace } from "./db/workspaces.ts";
import { getDecisionConfig, setDecisionConfig } from "./decision-config-store.ts";
import { listDecisionRecords } from "./decision-record-store.ts";
import { diffFloorMove, previewFloorMove, FLOOR_PREVIEW_NAME_CAP, floorPreviewBoardHref, type FloorMoveRoleInput } from "./floor-move-preview.ts";
import type { ScreenDecision } from "./screen-wave-contract.ts";
import type { ScreeningRule } from "./decision-config-schema.ts";

after(() => cleanupUnitDb());

// ---- the pure diff ---------------------------------------------------------------

const RULE = (floor: number): ScreeningRule => ({ autoRejectEnabled: true, rejectBottomPercent: 100, maxMatchToReject: floor, holdoutPercent: 0 });

function decision(entryId: string, score: number, action: "keep" | "reject", reasonCode: ScreenDecision["reasonCode"] = action === "reject" ? "reject" : "atThreshold"): ScreenDecision {
  return { entryId, label: `Person ${entryId}`, archetype: "bau", matchScore: score, action, rationale: "", reasonCode, reasonParams: {} };
}

test("diffFloorMove: keep->reject enters, reject->keep leaves, unchanged is in neither; rows carry id, label, score, job and a board link", () => {
  const role: FloorMoveRoleInput = {
    jobId: "job-a",
    jobTitle: "Backend Engineer",
    before: { config: RULE(45), decisions: [decision("e1", 44, "keep", "atThreshold"), decision("e2", 44, "reject"), decision("e3", 30, "reject")] },
    after: { config: RULE(45), decisions: [decision("e1", 44, "reject"), decision("e2", 44, "keep", "atThreshold"), decision("e3", 30, "reject")] },
  };
  const diff = diffFloorMove([role]);
  assert.equal(diff.roles.length, 1);
  const [r] = diff.roles;
  assert.deepEqual(r.entering.rows.map((x) => x.entryId), ["e1"]);
  assert.deepEqual(r.leaving.rows.map((x) => x.entryId), ["e2"]);
  assert.deepEqual(r.entering.rows[0], {
    entryId: "e1",
    label: "Person e1",
    matchScore: 44,
    jobId: "job-a",
    href: floorPreviewBoardHref("Person e1"),
  });
  assert.equal(r.jobTitle, "Backend Engineer");
  assert.deepEqual(diff.totals, { entering: 1, leaving: 1, shielded: 0, spared: 0 });
});

test("diffFloorMove groups per role, caps names per role and counts the rest; a role nothing moves on is left out", () => {
  const many = Array.from({ length: FLOOR_PREVIEW_NAME_CAP + 2 }, (_, i) => `m${i}`);
  const roles: FloorMoveRoleInput[] = [
    {
      jobId: "job-many",
      jobTitle: "Many",
      before: { config: RULE(40), decisions: many.map((id) => decision(id, 42, "keep", "atThreshold")) },
      after: { config: RULE(50), decisions: many.map((id) => decision(id, 42, "reject")) },
    },
    {
      jobId: "job-one",
      jobTitle: "One",
      before: { config: RULE(40), decisions: [decision("o1", 45, "keep", "atThreshold")] },
      after: { config: RULE(50), decisions: [decision("o1", 45, "reject")] },
    },
    {
      jobId: "job-still",
      jobTitle: "Still",
      before: { config: RULE(40), decisions: [decision("s1", 80, "keep", "aboveCutoff")] },
      after: { config: RULE(50), decisions: [decision("s1", 80, "keep", "aboveCutoff")] },
    },
  ];
  const diff = diffFloorMove(roles);
  assert.deepEqual(diff.roles.map((r) => r.jobId), ["job-many", "job-one"], "grouped per role, the most-moved first, the unmoved role omitted");
  const big = diff.roles[0];
  assert.equal(big.entering.rows.length, FLOOR_PREVIEW_NAME_CAP);
  assert.equal(big.entering.total, FLOOR_PREVIEW_NAME_CAP + 2);
  assert.equal(big.entering.more, 2);
  assert.equal(diff.roles[1].entering.more, 0);
  assert.equal(diff.totals.entering, FLOOR_PREVIEW_NAME_CAP + 3);
  const href = floorPreviewBoardHref("Nováková Jana");
  assert.ok(href.startsWith("/?tab=pipeline&"), "a board deep link names its tab (UAT TOM-ANA-1)");
  assert.equal(new URLSearchParams(href.slice(2)).get("q"), "Nováková Jana");
});

// ---- the preview over a real board ------------------------------------------------

let seq = 0;
function seed(ws: string, jobId: string, matchScore: number, opts: { archetype?: string; roleFamily?: string } = {}) {
  seq += 1;
  const { entry } = createPipelineEntry({
    candidateId: `fp-c${seq}`,
    candidateLabel: `Floor Preview ${seq}`,
    jobId,
    jobTitle: `Role ${jobId}`,
    stage: "Screened",
    matchScore,
    archetype: opts.archetype ?? "bau",
    roleFamily: opts.roleFamily ?? "software_engineering",
    contact: `fp-c${seq}@example.com`,
    workspaceId: ws,
  });
  return entry;
}

function saveRule(ws: string, rule: ScreeningRule) {
  setDecisionConfig("screening", rule as unknown as Record<string, unknown>, ws, "team");
}

function snapshot(ws: string): string {
  return JSON.stringify({
    board: listPipeline(ws),
    events: listPipelineEvents(1000, 0, undefined, ws),
    records: listDecisionRecords({ workspaceId: ws, limit: 1000 }),
    rule: getDecisionConfig("screening", ws),
  });
}

test("previewFloorMove names the Screened entries a raised floor pulls into reach, and writes nothing", async () => {
  const ws = createWorkspace("Floor preview raise").id;
  saveRule(ws, { autoRejectEnabled: true, rejectBottomPercent: 100, maxMatchToReject: 40, holdoutPercent: 0 });
  const a = seed(ws, "fp-job", 42);
  const b = seed(ws, "fp-job", 45);
  const c = seed(ws, "fp-job", 48);
  const before = snapshot(ws);

  const preview = await previewFloorMove(ws, { suggestedThreshold: 50 });

  assert.equal(preview.autoRejectOff, false);
  assert.equal(preview.currentThreshold, 40);
  assert.equal(preview.suggestedThreshold, 50);
  assert.equal(preview.roles.length, 1);
  assert.deepEqual(new Set(preview.roles[0].entering.rows.map((r) => r.entryId)), new Set([a.id, b.id, c.id]));
  assert.equal(preview.totals.leaving, 0);
  assert.equal(snapshot(ws), before, "a preview writes no pipeline row, event, sealed record or config");
});

test("a fairness-protected candidate the move would reach is shielded, never entering", async () => {
  const ws = createWorkspace("Floor preview shield").id;
  saveRule(ws, { autoRejectEnabled: true, rejectBottomPercent: 100, maxMatchToReject: 40, holdoutPercent: 0 });
  const bau = seed(ws, "fp-shield", 42);
  const student = seed(ws, "fp-shield", 44, { archetype: "student" });

  const preview = await previewFloorMove(ws, { suggestedThreshold: 50 });

  const role = preview.roles[0];
  assert.deepEqual(role.entering.rows.map((r) => r.entryId), [bau.id]);
  assert.ok(!role.entering.rows.some((r) => r.entryId === student.id));
  assert.equal(role.shielded, 1);
  assert.equal(preview.totals.shielded, 1);
});

test("family scope moves only that family, over the MERGED family-floor map", async () => {
  const ws = createWorkspace("Floor preview family").id;
  // data_ai carries its own saved floor of 60. An override of { familyFloors: {
  // software_engineering: 50 } } REPLACES the map, so data_ai would fall back to the
  // global 40 in the "after" rule and its 55 would show up as leaving reach.
  saveRule(ws, { autoRejectEnabled: true, rejectBottomPercent: 100, maxMatchToReject: 40, familyFloors: { data_ai: 60 }, holdoutPercent: 0 });
  const se = seed(ws, "fp-fam", 45, { roleFamily: "software_engineering" });
  const dataKept = seed(ws, "fp-fam", 45, { roleFamily: "sales_marketing" });
  const dataFloored = seed(ws, "fp-fam", 55, { roleFamily: "data_ai" });

  const preview = await previewFloorMove(ws, { suggestedThreshold: 50, roleFamily: "software_engineering" });

  assert.equal(preview.roleFamily, "software_engineering");
  assert.equal(preview.currentThreshold, 40, "the family has no override, so its effective floor is the global one");
  const all = preview.roles.flatMap((r) => [...r.entering.rows, ...r.leaving.rows]).map((r) => r.entryId);
  assert.deepEqual(all, [se.id]);
  assert.ok(!all.includes(dataKept.id), "another family at 45 is in neither list");
  assert.ok(!all.includes(dataFloored.id), "the saved data_ai floor survives the family preview");
});

test("auto-reject off: nothing is in reach, and the preview says so instead of counting", async () => {
  const ws = createWorkspace("Floor preview off").id;
  saveRule(ws, { autoRejectEnabled: false, rejectBottomPercent: 100, maxMatchToReject: 40, holdoutPercent: 0 });
  seed(ws, "fp-off", 42);
  const before = snapshot(ws);

  const preview = await previewFloorMove(ws, { suggestedThreshold: 50 });

  assert.equal(preview.autoRejectOff, true);
  assert.deepEqual(preview.roles, []);
  assert.deepEqual(preview.totals, { entering: 0, leaving: 0, shielded: 0, spared: 0 });
  assert.equal(snapshot(ws), before);
});
