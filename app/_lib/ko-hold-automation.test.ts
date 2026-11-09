// A KNOCKOUT HOLD IS NOT TOUCHED BY AUTOMATION until a person acts (owner ruling Q1).
//
// The held entry is an ordinary pipeline entry behind the `decision` approval
// (knockout-hold.ts), so what keeps automation off it is the approval the whole system
// already treats as "a person is on this" — not a new flag nobody else reads. This file
// proves that against the REAL policy pass (the Python policy, spawned), with a control
// that proves the pass is live: the same candidate WITHOUT the hold is advanced.
//
//   - policy pass (scoring-driven advance / reject): the held entry never reaches it.
//     The policy's own "approval already pending" hold covers a screening column only; its
//     ENTRY-column branch advances any scored entry without reading the approval (an
//     upstream gap, reported), so executeAutomationPass excludes a hold up front. Proven
//     below with the hold made as advanceable as possible — scored, classified, not a
//     stub — where the pass, left unguarded, advances it;
//   - the scoring sweep skips it (a stub is intake-degraded, so isScorableEntry is false);
//   - stage hooks (invites, work samples) run on a stage ARRIVAL and the filing is not
//     one: nothing is armed or minted, and the approval is not overwritten;
//   - the person's own door still works on it (confirm / clear: ko-decline-door.test.ts).
//
// unit-db.ts MUST be the first project import.
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createPipelineEntry, getPipelineEntry, listPipelineEventsForEntry } from "./db/pipeline.ts";
import { ensureDb } from "./db/core.ts";
import { fileApplication } from "./application-filing.ts";
import { insertJob } from "./job-ingest.ts";
import { getJob } from "./db/jobs.ts";
import { runAutomationPass } from "./automation-pass.ts";
import { isScorableEntry } from "./entry-scoring-policy.ts";
import { knockoutHoldDetail, parseKnockoutHold } from "./knockout-hold.ts";
import { DEFAULT_WORKSPACE_ID } from "./db/workspaces.ts";

after(() => cleanupUnitDb());

const JOB_ID = "ko-hold-automation-job";
insertJob({ id: JOB_ID, title: "Backend Engineer" } as never, undefined, "published", DEFAULT_WORKSPACE_ID);

test("the policy pass leaves a held knockout entry exactly where it is — and advances the same candidate without the hold", async () => {
  const job = getJob(JOB_ID);
  assert.ok(job);

  // The hold, filed through the real core. Then made as "advanceable" as the policy
  // could ever find it (scored, classified, not a stub) so the ONLY thing between it and
  // an advance is the approval — that is what this test is about.
  const filed = await fileApplication({
    job,
    name: "Held Candidate",
    email: "held.automation@example.invalid",
    locale: "en",
    sourceChannel: "apply",
    channelLabel: "conversational apply",
    proof: "none",
    stub: { idPrefix: "apply", reason: "reason:knockoutHeld" },
    hold: { failedKoIds: ["ko_auth"] },
  });
  assert.equal(filed.kind, "created");
  const held = filed.entry;
  assert.equal(held.approvalKind, "decision");
  assert.deepEqual(parseKnockoutHold(held.approvalKind, held.approvalDetail)?.failedKoIds, ["ko_auth"]);
  assert.equal(isScorableEntry(held), false, "a held stub is not scored by the sweep either");
  ensureDb()
    .prepare(`UPDATE pipeline_entries SET archetype = 'bau', match_score = 95, intake_degraded = 0 WHERE id = ?`)
    .run(held.id);

  // The control: identical in every respect except that it carries no approval.
  const control = createPipelineEntry({
    candidateId: "ko-hold-control",
    candidateLabel: "Control Candidate",
    archetype: "bau",
    jobId: JOB_ID,
    jobTitle: "Backend Engineer",
    stage: held.stage,
    matchScore: 95,
    contact: "control.automation@example.invalid",
  }).entry;
  assert.equal(control.approvalKind, null);

  const before = getPipelineEntry(held.id, DEFAULT_WORKSPACE_ID)!;
  const result = await runAutomationPass();

  assert.equal(
    result.decisions.some((d) => d.entryId === held.id),
    false,
    "the held entry is not evaluated at all — no advance, reject, hold or alert is decided about it"
  );
  const controlDecision = result.decisions.find((d) => d.entryId === control.id);
  assert.equal(controlDecision?.action, "advance", "non-vacuity: the same candidate without the hold IS advanced by this pass");

  const after = getPipelineEntry(held.id, DEFAULT_WORKSPACE_ID)!;
  assert.equal(after.stage, before.stage, "not advanced");
  assert.equal(after.status, "active", "not rejected");
  assert.equal(after.approvalKind, "decision", "the hold is untouched — not replaced by a rejection_review or a calendar gate");
  assert.equal(after.approvalDetail, before.approvalDetail, "…and still names the failed must-have");
  const kinds = listPipelineEventsForEntry(held.id, 100, DEFAULT_WORKSPACE_ID).map((e) => e.kind);
  assert.ok(!kinds.some((k) => ["advanced", "auto_advanced", "rejected", "auto_rejected", "scored"].includes(k)), `automation wrote nothing about the held entry (got ${kinds.join(",")})`);
  assert.notEqual(getPipelineEntry(control.id, DEFAULT_WORKSPACE_ID)!.stage, control.stage, "the control moved");
});

test("a hold's payload round-trips and a Match add's bare decision approval is never read as one", () => {
  const detail = knockoutHoldDetail(["ko_auth", "ko_lang", "ko_auth", "not a valid id!"]);
  assert.deepEqual(parseKnockoutHold("decision", detail)?.failedKoIds, ["ko_auth", "ko_lang"], "deduped and shape-checked");
  assert.equal(parseKnockoutHold("decision", ""), null, "a Match add files a decision approval with no payload");
  assert.equal(parseKnockoutHold("decision", JSON.stringify({ recommendation: "advance" })), null);
  assert.equal(parseKnockoutHold("screening_review", detail), null, "only the `decision` approval can be a hold");
  assert.equal(parseKnockoutHold("decision", "not json"), null);
  assert.equal(JSON.parse(detail).recommendation, undefined, "the gate proposes no outcome");
});
