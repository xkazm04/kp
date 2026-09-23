// Real-DB coverage for the Reconsider queue's membership rule (challenge-r07 follow-up).
//
// POST /api/pipeline/[id] reinstate answers 409 PIPELINE_NOT_REINSTATABLE unless the
// entry's NEWEST decision event (auto_rejected / rejected / reinstated) is the machine's
// auto_rejected. listReconsiderQueue used to list any rejected entry that EVER carried an
// auto_rejected event, so an entry auto-rejected, reinstated, then rejected by a human sat
// in Reconsider offering a Reinstate the door refused. Both now read one rule.
//
// unit-db.ts MUST be the first project import (it sets KP_DB_PATH so every store
// opens a throwaway SQLite file unique to this process).
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { ensureDb, recordEvent } from "./core.ts";
import {
  actOnPipelineEntry,
  createPipelineEntry,
  listReconsiderQueue,
  newestDecisionIsAutoRejection,
  reinstatePipelineEntry,
} from "./pipeline.ts";

after(() => cleanupUnitDb());

let seq = 0;
function entry(): string {
  seq += 1;
  return createPipelineEntry({
    candidateId: `recon-cand-${seq}`,
    candidateLabel: `Recon ${seq}`,
    jobId: "recon-job",
    jobTitle: "Reconsider Role",
    stage: "Screened",
  }).entry.id;
}
const autoReject = (id: string) => assert.ok(actOnPipelineEntry(id, "reject", undefined, { actor: "system" }));
const humanReject = (id: string) => assert.ok(actOnPipelineEntry(id, "reject", undefined, { actor: "human" }));
const reinstate = (id: string) => assert.ok(reinstatePipelineEntry(id));
const queued = () => new Set(listReconsiderQueue(200).items.map((i) => i.entry.id));

test("Reconsider lists an entry only while its newest decision is an auto-rejection", () => {
  const autoOnly = entry();
  autoReject(autoOnly);

  const reinstatedThenHuman = entry();
  autoReject(reinstatedThenHuman);
  reinstate(reinstatedThenHuman);
  humanReject(reinstatedThenHuman);

  const reinstatedThenAuto = entry();
  autoReject(reinstatedThenAuto);
  reinstate(reinstatedThenAuto);
  autoReject(reinstatedThenAuto);

  const humanOnly = entry();
  humanReject(humanOnly);

  const ids = queued();
  const { total } = listReconsiderQueue(200);
  assert.ok(ids.has(autoOnly), "auto_rejected only: listed");
  assert.ok(!ids.has(reinstatedThenHuman), "auto_rejected -> reinstated -> rejected: the newest decision is human, not listed");
  assert.ok(ids.has(reinstatedThenAuto), "auto_rejected -> reinstated -> auto_rejected: reversible again, listed");
  assert.ok(!ids.has(humanOnly), "a plain human reject is a decision, never a queue item");
  assert.equal(total, ids.size, "the count is cut from the same set as the page");
  assert.equal(total, 2);
});

// The door's predicate is the queue's predicate. These are the classification cases the
// door's old in-memory reader was pinned by (entry-actions.test.ts), now on real rows.
test("newestDecisionIsAutoRejection: the reinstate door's rule, read from the same SQL as the queue", () => {
  const plain = entry();
  assert.equal(newestDecisionIsAutoRejection(plain), false, "no decision at all");

  const auto = entry();
  autoReject(auto);
  assert.equal(newestDecisionIsAutoRejection(auto), true);
  // Non-decision events after the rejection (a note, an approval) do not hide it.
  recordEvent(ensureDb(), { entryId: auto, kind: "approval_set" });
  recordEvent(ensureDb(), { entryId: auto, kind: "github_evidence_attached" });
  assert.equal(newestDecisionIsAutoRejection(auto), true);

  // Reinstated: the auto-rejection is spent (classified EXPLICITLY).
  reinstate(auto);
  assert.equal(newestDecisionIsAutoRejection(auto), false);
  // Auto-rejected again: reversible again.
  autoReject(auto);
  assert.equal(newestDecisionIsAutoRejection(auto), true);
  // Then reinstated and rejected by hand: the newest decision is human.
  reinstate(auto);
  humanReject(auto);
  assert.equal(newestDecisionIsAutoRejection(auto), false);

  const human = entry();
  humanReject(human);
  assert.equal(newestDecisionIsAutoRejection(human), false, "a recruiter's hand reject");

  // Tenancy: another workspace never reads this entry's rule as true.
  const other = entry();
  autoReject(other);
  assert.equal(newestDecisionIsAutoRejection(other, "some-other-workspace"), false);
});
