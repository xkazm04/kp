// Pins the policy pass's STAGE FACTS (challenge-r10 pipeline-core/B): every entry the
// TS pass hands Python carries its `stageRole` and `advanceTo`, both resolved on the
// entry's OWN workspace axis, so `evaluate_entry` decides by role and names the column
// the commit will actually land on.
//
// The defect this locks out: evaluate_entry branched on the five shipped stage NAMES.
// On a composed board (Settings -> Hiring) the entry column never auto-advanced, a
// renamed screening column had no rule at all ("no policy for this stage"), and the
// preview promised a literal "Screened"/"Interview" landing while the commit's
// actOnPipelineEntry("accept") landed on nextStageOnAxis - a different column.
//
// unit-db.ts first: automation-pass.ts sits on the store's import graph.
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { withPolicyStageFacts } from "./automation-pass.ts";
import { nextStageOnAxis } from "./db/pipeline-core.ts";
import { DEFAULT_STAGE_AXIS, type StageDef } from "./pipeline-stages.ts";

after(cleanupUnitDb);

const RENAMED: readonly StageDef[] = [
  { id: "Inbox", label: "Inbox", role: "entry" },
  { id: "Phone", label: "Phone", role: "screening" },
  { id: "Panel", label: "Panel", role: "interview" },
  { id: "Signed", label: "Signed", role: "terminal" },
];

const entry = (id: string, stage: string, workspaceId = "ws-renamed") => ({ id, stage, workspaceId });

test("stamps role and the axis's own next column on a renamed board", () => {
  const out = withPolicyStageFacts([entry("a", "Inbox"), entry("b", "Phone"), entry("c", "Signed"), entry("d", "Offer")], () => RENAMED);
  const byId = new Map(out.map((e) => [e.id, e]));
  assert.deepEqual([byId.get("a")!.stageRole, byId.get("a")!.advanceTo], ["entry", "Phone"]);
  assert.deepEqual([byId.get("b")!.stageRole, byId.get("b")!.advanceTo], ["screening", "Panel"]);
  // The terminal column has no "next": advanceTo is null, never the column itself.
  assert.deepEqual([byId.get("c")!.stageRole, byId.get("c")!.advanceTo], ["terminal", null]);
  // A retired / off-axis stage has no meaning to resolve (the roleOf doctrine).
  assert.deepEqual([byId.get("d")!.stageRole, byId.get("d")!.advanceTo], [null, null]);
});

test("advanceTo is exactly where actOnPipelineEntry('accept') lands (nextStageOnAxis)", () => {
  for (const axis of [RENAMED, DEFAULT_STAGE_AXIS]) {
    const entries = axis.map((s, i) => entry(`e${i}`, s.id));
    for (const e of withPolicyStageFacts(entries, () => axis)) {
      const landing = nextStageOnAxis(e.stage, axis);
      assert.equal(e.advanceTo, landing === e.stage ? null : landing, e.stage);
    }
  }
});

test("the shipped board stamps the shipped roles and successors", () => {
  const out = withPolicyStageFacts(DEFAULT_STAGE_AXIS.map((s) => entry(s.id, s.id, "ws-default")), () => DEFAULT_STAGE_AXIS);
  assert.deepEqual(
    out.map((e) => [e.stage, e.stageRole, e.advanceTo]),
    [
      ["Accepted", "entry", "Screened"],
      ["Screened", "screening", "Interview"],
      ["Interview", "interview", "Offer"],
      ["Offer", "offer", "Hired"],
      ["Hired", "terminal", null],
    ]
  );
});

test("each entry is resolved on ITS OWN workspace's axis, read once per workspace", () => {
  const reads: string[] = [];
  const axisFor = (ws: string) => {
    reads.push(ws);
    return ws === "ws-renamed" ? RENAMED : DEFAULT_STAGE_AXIS;
  };
  const out = withPolicyStageFacts(
    [entry("a", "Inbox"), entry("b", "Accepted", "ws-default"), entry("c", "Phone"), entry("d", "Inbox", "ws-default")],
    axisFor
  );
  assert.deepEqual(
    out.map((e) => [e.id, e.stageRole, e.advanceTo]),
    [
      ["a", "entry", "Phone"],
      ["b", "entry", "Screened"],
      ["c", "screening", "Panel"],
      // "Inbox" is not a column on the shipped board: off-axis there.
      ["d", null, null],
    ]
  );
  assert.deepEqual(reads.sort(), ["ws-default", "ws-renamed"]);
});

test("the stamp is additive: every other snapshot field crosses unchanged", () => {
  const src = { id: "x", stage: "Phone", workspaceId: "ws-renamed", matchScore: 72, archetype: "bau", agingTier: "none" };
  const [out] = withPolicyStageFacts([src], () => RENAMED);
  assert.deepEqual(out, { ...src, stageRole: "screening", advanceTo: "Panel" });
});

test("source pin: the pass hands Python the STAMPED snapshot", () => {
  const src = readFileSync(new URL("./automation-pass.ts", import.meta.url), "utf-8");
  assert.match(src, /withPolicyStageFacts\(\s*entries\s*,/);
  // entries.json is written from the stamped list, never the bare snapshot.
  assert.doesNotMatch(src, /writeFile\(\s*inputPath\s*,\s*JSON\.stringify\(\s*entries\s*\)/);
});
