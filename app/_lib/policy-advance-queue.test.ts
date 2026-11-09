// Q2 (owner ruling 2026-11-09): a score-threshold advance is QUEUED for a person, never
// applied by the policy pass. Proven against the REAL policy (the Python engine, spawned)
// for BOTH branches that propose an advance:
//
//   - the entry column  (any scored entry),
//   - the screening column (non-early-career, score >= bau_advance_score, after the
//     settling days),
//
// in the PREVIEW and in the COMMIT: an approval is queued (or forecast), no entry moves,
// `summary.advanced` is 0. A person's accept then moves the entry exactly one stage and
// seals as a human decision carrying the machine's reason; a decline leaves it in place
// and a second pass does not queue it again.
//
// unit-db.ts MUST be the first project import.
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import {
  createPipelineEntry,
  declineQueuedAdvance,
  getPipelineEntry,
  listActiveEntriesForAutomation,
  listPipelineEventsForEntry,
} from "./db/pipeline.ts";
import { ensureDb } from "./db/core.ts";
import { runAutomationPass } from "./automation-pass.ts";
import { runPipelineEntryAction } from "./pipeline-entry-action.ts";
import { listDecisionRecords } from "./decision-record-store.ts";
import { parsePolicyAdvance } from "./approval-kinds.ts";
import { DEFAULT_WORKSPACE_ID } from "./db/workspaces.ts";

after(() => cleanupUnitDb());

const WS = DEFAULT_WORKSPACE_ID;
const ORIGIN = "http://localhost:3000";
let seq = 0;

function seed(stage: string, opts: { daysInStage?: number; score?: number } = {}) {
  seq += 1;
  const { entry } = createPipelineEntry({
    candidateId: `q2-c${seq}`,
    candidateLabel: `Q2 Candidate ${seq}`,
    archetype: "bau",
    jobId: `q2-job-${seq}`,
    jobTitle: "Q2 Role",
    stage,
    matchScore: opts.score ?? 80,
    contact: `q2-c${seq}@example.invalid`,
  });
  if (opts.daysInStage) {
    const at = new Date(Date.now() - opts.daysInStage * 86_400_000).toISOString();
    ensureDb().prepare(`UPDATE pipeline_entries SET stage_changed_at = ? WHERE id = ?`).run(at, entry.id);
  }
  return entry.id;
}
const row = (id: string) => getPipelineEntry(id, WS)!;
const kinds = (id: string) => listPipelineEventsForEntry(id, 100, WS).map((e) => e.kind);
const decisionOf = (result: Awaited<ReturnType<typeof runAutomationPass>>, id: string) => result.decisions.find((d) => d.entryId === id);

const BRANCHES = [
  { name: "entry column", stage: "Accepted", to: "Screened", opts: {} },
  { name: "screening column", stage: "Screened", to: "Interview", opts: { daysInStage: 5 } },
] as const;

for (const b of BRANCHES) {
  test(`${b.name}: the preview forecasts a queued approval and the commit queues it - nothing moves`, async () => {
    const id = seed(b.stage, b.opts);

    const preview = await runAutomationPass({ dryRun: true });
    const forecast = decisionOf(preview, id);
    assert.equal(forecast?.action, "advance", "non-vacuity: the policy does propose the advance");
    assert.equal(forecast?.toStage, b.to);
    assert.equal(forecast?.outcome, "queued", "the preview forecasts the SAME encoding as the commit");
    assert.equal(forecast?.reasonCode, "wouldBeQueuedForApproval");
    assert.equal(row(id).approvalKind, null, "a preview writes nothing");
    assert.equal(row(id).stage, b.stage);

    const commit = await runAutomationPass();
    const done = decisionOf(commit, id);
    assert.equal(done?.outcome, "queued");
    assert.equal(done?.reasonCode, "queuedForApproval");
    assert.equal(commit.summary.advanced, 0, "summary.advanced is 0 in a committed run");
    const after = row(id);
    assert.equal(after.stage, b.stage, "the pass moved nothing");
    assert.equal(after.approvalKind, "screening_review");
    assert.deepEqual(parsePolicyAdvance(after.approvalKind, after.approvalDetail), { toStage: b.to });
    const detail = JSON.parse(after.approvalDetail!);
    assert.equal(detail.recommendation, "advance");
    assert.match(detail.rationale, /match score 80|BAU score 80/, "the policy's own reason rides the approval");
    assert.ok(!kinds(id).includes("auto_advanced"), "no unattended advance event");
    assert.ok(!kinds(id).includes("advanced"));

    // A second pass must not propose or queue it again: it holds on the pending approval.
    const second = await runAutomationPass();
    assert.equal(decisionOf(second, id)?.action, "hold");
    assert.equal(row(id).approvalDetail, after.approvalDetail, "the queued approval is untouched");
    assert.equal(kinds(id).filter((k) => k === "approval_set").length, 1, "queued exactly once");
  });
}

test("a person's accept on a queued entry-column advance moves exactly one stage, seals as a human, raises no calendar gate", async () => {
  const id = seed("Accepted");
  await runAutomationPass();
  assert.equal(row(id).approvalKind, "screening_review");
  const reason = JSON.parse(row(id).approvalDetail!).rationale as string;

  const res = await runPipelineEntryAction({ id, action: "accept", expectedStage: "Accepted", origin: ORIGIN, workspaceId: WS });
  assert.equal(res.status, 200);
  const moved = row(id);
  assert.equal(moved.stage, "Screened", "exactly one stage: the one the policy named");
  assert.equal(moved.approvalKind, null, "an entry-column advance is not an interview: no calendar gate");
  assert.ok(kinds(id).includes("advanced") && !kinds(id).includes("auto_advanced"), "a human advance, not the engine's");
  const [record] = listDecisionRecords({ candidateRef: id, workspaceId: WS });
  assert.equal(record.kind, "advanced");
  assert.match(record.actor, /^human:|^human$/);
  const inputs = (JSON.parse(record.payloadJson) as { inputs: Record<string, unknown> }).inputs;
  assert.equal(inputs.aiRecommendation, "advance");
  assert.equal(inputs.aiRationale, reason, "the machine's reason is sealed beside the person's decision");
  assert.equal(inputs.approvalKind, "screening_review");
});

test("a person's accept on a queued screening-column advance moves one stage and queues the interview calendar", async () => {
  const id = seed("Screened", { daysInStage: 5 });
  await runAutomationPass();
  assert.equal(row(id).approvalKind, "screening_review");
  const res = await runPipelineEntryAction({ id, action: "accept", expectedStage: "Screened", origin: ORIGIN, workspaceId: WS });
  assert.equal(res.status, 200);
  assert.equal(row(id).stage, "Interview");
  assert.equal(row(id).approvalKind, "calendar", "the ordinary screening handoff is unchanged");
  assert.equal(listDecisionRecords({ candidateRef: id, workspaceId: WS })[0].kind, "advanced");
});

for (const b of BRANCHES) {
  test(`${b.name}: a declined advance leaves the entry in place and is not queued again`, async () => {
    const id = seed(b.stage, b.opts);
    await runAutomationPass();
    assert.equal(row(id).approvalKind, "screening_review");

    const declined = declineQueuedAdvance(id, { expectedStage: b.stage, actorRef: "human:Tester" }, WS);
    assert.ok(declined, "the decline lands");
    assert.equal(row(id).stage, b.stage, "left in place");
    assert.equal(row(id).approvalKind, null, "no approval is left pending");
    assert.equal(row(id).status, "active", "a decline is not a rejection");

    assert.equal(listActiveEntriesForAutomation().find((e) => e.id === id)?.advanceDeclined, true);
    // Inside the 24h screening-override window the recentScreening guard already stands
    // the policy down ("none"); the decline must outlive that window.
    const next = await runAutomationPass();
    assert.notEqual(decisionOf(next, id)?.action, "advance", "no second proposal inside the window");
    assert.equal(row(id).approvalKind, null, "no duplicate approval");
    // Age the whole stint: the stage move and the decline both happened days ago, the
    // decline after the move, so it belongs to the current stint.
    const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
    ensureDb().prepare(`UPDATE pipeline_entries SET stage_changed_at = ? WHERE id = ?`).run(daysAgo(10), id);
    ensureDb().prepare(`UPDATE pipeline_events SET created_at = ? WHERE entry_id = ? AND kind = 'screening_hold'`).run(daysAgo(3), id);
    const later = await runAutomationPass();
    assert.equal(decisionOf(later, id)?.action, "hold", "past the window: no new grounds, still no second proposal");
    assert.match(decisionOf(later, id)?.reason ?? "", /declined by a person/);
    assert.equal(row(id).approvalKind, null, "no duplicate approval, days later either");

    // A stage move is new grounds: the flag is scoped to the stint.
    ensureDb().prepare(`UPDATE pipeline_entries SET stage_changed_at = ? WHERE id = ?`).run(new Date(Date.now() + 1000).toISOString(), id);
    assert.equal(listActiveEntriesForAutomation().find((e) => e.id === id)?.advanceDeclined, false);
  });
}

test("a decline only clears a queued POLICY advance - any other approval is untouched", () => {
  const id = seed("Screened");
  ensureDb().prepare(`UPDATE pipeline_entries SET approval_kind = 'screening_review', approval_detail = ? WHERE id = ?`).run(JSON.stringify({ recommendation: "hold" }), id);
  assert.equal(declineQueuedAdvance(id, {}, WS), null);
  assert.equal(row(id).approvalKind, "screening_review");
});
