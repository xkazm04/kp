import { test, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { UNIT_DB_PATH, cleanupUnitDb } from "./testing/unit-db.ts";
import { getDecisionConfig, setDecisionConfig, updateDecisionConfig, type ScreeningRule } from "./decision-config-store.ts";
import type { InterviewPlanRule } from "./decision-config-schema.ts";

after(() => cleanupUnitDb());

const read = (ws: string) => getDecisionConfig<ScreeningRule>("screening", ws).rejectBottomPercent;

// Behavioral tenancy for the dual-tier policy (P2): the org default cascades to every team
// until that team sets its own override; a team's override never touches another team.

test("the org default cascades to every team until a team overrides it", () => {
  // The org sets the company screening baseline (scope 'org' → workspace_id NULL).
  setDecisionConfig("screening", { autoRejectEnabled: true, rejectBottomPercent: 20, maxMatchToReject: 40 }, "ws-a", "org");
  assert.equal(read("ws-a"), 20, "team A inherits the org default");
  assert.equal(read("ws-b"), 20, "team B inherits the same org default");

  // Team A overrides just for itself (scope 'team').
  setDecisionConfig("screening", { autoRejectEnabled: true, rejectBottomPercent: 55, maxMatchToReject: 40 }, "ws-a", "team");
  assert.equal(read("ws-a"), 55, "team A now sees its own override (cascade: team wins)");
  assert.equal(read("ws-b"), 20, "team B still inherits the org default — untouched by A's override");
});

test("a team override doesn't create or move the org default", () => {
  setDecisionConfig("screening", { autoRejectEnabled: true, rejectBottomPercent: 33, maxMatchToReject: 40 }, "ws-c", "team");
  // ws-c sees its override; a brand-new team (ws-d) with no override falls through to the
  // org default set above (20), never to ws-c's private value.
  assert.equal(read("ws-c"), 33, "team C sees its override");
  assert.equal(read("ws-d"), 20, "a team with no override reads the org default, not another team's");
});

// family-floors preservation (family-floors follow-up): most screening writers (the
// rules modal) predate familyFloors and omit the key on a whole-row save — omission
// must PRESERVE the tier's stored overrides, never silently clear them. An explicit
// empty map still clears, so clearing stays expressible.
test("a same-tier write that omits familyFloors preserves them; an explicit {} clears", () => {
  const ws = "ws-floors";
  setDecisionConfig(
    "screening",
    { autoRejectEnabled: true, rejectBottomPercent: 20, maxMatchToReject: 40, familyFloors: { legal_compliance: 55 } },
    ws,
    "team"
  );
  // A modal-style save without the key: floors survive.
  setDecisionConfig("screening", { autoRejectEnabled: true, rejectBottomPercent: 25, maxMatchToReject: 45 }, ws, "team");
  const kept = getDecisionConfig<ScreeningRule>("screening", ws);
  assert.equal(kept.rejectBottomPercent, 25, "the write itself lands");
  assert.deepEqual(kept.familyFloors, { legal_compliance: 55 }, "omission preserves the stored overrides");

  // The OTHER tier is untouched by preservation (org row has no floors to inherit).
  setDecisionConfig("screening", { autoRejectEnabled: true, rejectBottomPercent: 10, maxMatchToReject: 30 }, ws, "org");
  const orgRowEffective = getDecisionConfig<ScreeningRule>("screening", "ws-other-team");
  assert.equal(orgRowEffective.familyFloors, undefined, "org tier gained no floors from the team tier");

  // Explicit empty map clears.
  setDecisionConfig(
    "screening",
    { autoRejectEnabled: true, rejectBottomPercent: 25, maxMatchToReject: 45, familyFloors: {} },
    ws,
    "team"
  );
  const cleared = getDecisionConfig<ScreeningRule>("screening", ws);
  assert.deepEqual(cleared.familyFloors ?? {}, {}, "an explicit empty map clears the overrides");
});

// --- the transactional read-modify-write (updateDecisionConfig) ---------------------
//
// `getDecisionConfig(...)` → think → `setDecisionConfig({...current, x})` is a LOST
// UPDATE whenever the "think" step is slow. /api/analytics/calibration/apply-threshold
// spends two full-table calibration scans between its read and its write; two applies
// for two DIFFERENT role families that interleave inside that window each merge onto the
// same stale familyFloors map, and the first family's floor — a live auto-reject rule —
// vanishes while both applies seal a record saying they succeeded.
//
// better-sqlite3 is SYNCHRONOUS, so nothing can interleave mid-transaction inside one
// process and the race itself is not directly reproducible here. What IS provable, and
// is the property that closes it: the mutation is applied to a value RE-READ at write
// time, never to the caller's snapshot. Both arms below do the same interleaving; only
// the transactional one keeps both floors.
test("updateDecisionConfig mutates a RE-READ, so an interleaved write is not clobbered", () => {
  const ws = "ws-rmw";
  setDecisionConfig("screening", { autoRejectEnabled: true, rejectBottomPercent: 20, maxMatchToReject: 45 }, ws, "team");

  // Operator A reads the rule, then goes off to re-derive a recommendation (slow).
  const staleSnapshot = getDecisionConfig<ScreeningRule>("screening", ws);
  // Operator B's apply for a DIFFERENT family lands in the meantime.
  setDecisionConfig(
    "screening",
    { ...staleSnapshot, familyFloors: { ...(staleSnapshot.familyFloors ?? {}), data_ai: 70 } },
    ws,
    "team"
  );
  // Operator A finally writes — through the transactional primitive, which re-reads.
  updateDecisionConfig<ScreeningRule>(
    "screening",
    (current) => ({ ...current, familyFloors: { ...(current.familyFloors ?? {}), software_engineering: 30 } }),
    ws,
    "team"
  );
  assert.deepEqual(
    getDecisionConfig<ScreeningRule>("screening", ws).familyFloors,
    { data_ai: 70, software_engineering: 30 },
    "both families' floors survive — A's write merged onto B's committed value, not A's snapshot"
  );

  // The shape the route uses today, for contrast: merging onto the stale snapshot drops
  // the other family's floor entirely. This is the failure the primitive removes.
  const ws2 = "ws-rmw-stale";
  setDecisionConfig("screening", { autoRejectEnabled: true, rejectBottomPercent: 20, maxMatchToReject: 45 }, ws2, "team");
  const stale2 = getDecisionConfig<ScreeningRule>("screening", ws2);
  setDecisionConfig("screening", { ...stale2, familyFloors: { ...(stale2.familyFloors ?? {}), data_ai: 70 } }, ws2, "team");
  setDecisionConfig(
    "screening",
    { ...stale2, familyFloors: { ...(stale2.familyFloors ?? {}), software_engineering: 30 } },
    ws2,
    "team"
  );
  assert.deepEqual(
    getDecisionConfig<ScreeningRule>("screening", ws2).familyFloors,
    { software_engineering: 30 },
    "the stale-snapshot merge silently loses data_ai's floor"
  );
});

test("updateDecisionConfig validates like setDecisionConfig and writes only its own tier", () => {
  const ws = "ws-rmw-tier";
  setDecisionConfig("screening", { autoRejectEnabled: false, rejectBottomPercent: 10, maxMatchToReject: 30 }, ws, "org");
  // A team-scoped update starts from the ORG baseline it inherits and lands on the TEAM row.
  const written = updateDecisionConfig<ScreeningRule>(
    "screening",
    (current) => {
      assert.equal(current.rejectBottomPercent, 10, "the mutation is handed the inherited org baseline");
      return { ...current, maxMatchToReject: 9999 };
    },
    ws,
    "team"
  );
  assert.equal(written.maxMatchToReject, 100, "the write boundary still clamps");
  assert.equal(getDecisionConfig<ScreeningRule>("screening", ws).maxMatchToReject, 100);
  assert.equal(
    getDecisionConfig<ScreeningRule>("screening", "ws-rmw-other").maxMatchToReject,
    30,
    "another team still reads the untouched org baseline"
  );
  // A mutation producing an invalid config is refused at the same backstop.
  assert.throws(
    () => updateDecisionConfig("screening", () => ({ autoRejectEnabled: "yes" }), ws, "team"),
    /autoRejectEnabled/
  );
  assert.equal(getDecisionConfig<ScreeningRule>("screening", ws).maxMatchToReject, 100, "the refused update changed nothing");
});

// --- pre-stage-keyed interviewPlan blobs (the shape the schema module promises to read)
//
// The plan used to be three loose fields with no `steps`. decision-config-schema.ts still
// carries LegacyInterviewPlanRule / isLegacyInterviewPlan / migrateLegacyInterviewPlan and
// states such a blob "can still be read … nothing has to be rewritten on disk". The READ
// path is where that promise is kept or broken: getDecisionConfig merges the stored blob
// over the phase DEFAULT, and a legacy blob has no `steps` of its own — so the merge would
// hand it the default's steps, and every reader (getInterviewPlan → prunePlanToAxis) looks
// at `steps` and nothing else.
test("a legacy interviewPlan blob is migrated on read, not overwritten by the default's steps", () => {
  const ws = "ws-legacy-plan";
  // Force the store's schema into existence, then write the pre-migration wire shape
  // directly — setDecisionConfig would convert it, which is exactly the path a deployed
  // database that has not saved since the migration never took.
  getDecisionConfig("interviewPlan", ws);
  const raw = new Database(UNIT_DB_PATH);
  raw
    .prepare(`INSERT INTO decision_config (phase, config_json, updated_at, workspace_id) VALUES (?, ?, ?, ?)`)
    .run(
      "interviewPlan",
      JSON.stringify({
        screeningGate: "auto",
        rounds: [
          { kind: "ai", gate: "auto", topN: null },
          { kind: "human", gate: "human", topN: 3 },
        ],
        offerGate: "auto",
      }),
      new Date().toISOString(),
      ws
    );
  raw.close();

  const plan = getDecisionConfig<InterviewPlanRule>("interviewPlan", ws);
  const rounds = plan.steps.flatMap((s) => s.rounds);
  assert.equal(rounds.length, 2, "the workspace's TWO saved rounds survive the read (the shipped default has one)");
  assert.deepEqual(rounds.map((r) => r.kind), ["ai", "human"], "including the human round the default does not have");
  assert.equal(
    plan.steps.find((s) => s.stageId === "Screened")?.gate,
    "auto",
    "the saved screening gate survives (the shipped default is 'human')"
  );
  // No legacy keys leak through the merge onto the stage-keyed shape.
  const leaked = ["screeningGate", "offerGate", "rounds"].filter((k) => k in (plan as unknown as Record<string, unknown>));
  assert.deepEqual(leaked, [], "the migrated plan carries no legacy wire keys");
});
