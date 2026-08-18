// migratePipelineStages — the write behind "this step is being removed; where do
// its candidates go?" (Settings → Hiring).
//
// This is the one settings change that touches real candidate records, so the
// three properties that make it safe are pinned here rather than trusted: every
// leg commits together, every moved candidate gets an audit event naming where
// they came from, and terminal (rejected/declined) rows are never rewritten.
//
// Runs against an ISOLATED throwaway DB — which SELF-SEEDS the demo corpus, so
// every assertion below is a DELTA against a measured baseline rather than an
// absolute count. (testing/unit-db.ts must stay the first project import.)
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "../testing/unit-db.ts";
import {
  actOnPipelineEntry,
  countPipelineByStage,
  createPipelineEntry,
  listPipelineEventsForEntry,
  migratePipelineStages,
  setPipelineEntryStage,
} from "./pipeline.ts";

after(() => cleanupUnitDb());

let seq = 0;
function entryAt(stage: string): string {
  seq += 1;
  const { entry } = createPipelineEntry({
    candidateId: `mig-c${seq}`,
    candidateLabel: `Migrant ${seq}`,
    jobId: "mig-job",
    jobTitle: "Role under migration",
  });
  setPipelineEntryStage(entry.id, stage);
  return entry.id;
}

const at = (stage: string) => countPipelineByStage()[stage] ?? 0;
const migrationEvents = (id: string) => listPipelineEventsForEntry(id).filter((e) => e.kind === "stage_migrated");

test("every candidate on a removed step moves, and each gets an audit event", () => {
  const a = entryAt("Interview");
  const b = entryAt("Interview");
  const untouched = entryAt("Screened");
  const onInterview = at("Interview");
  const onScreened = at("Screened");
  assert.ok(onInterview >= 2, "precondition: the step we are removing has occupants");

  const moved = migratePipelineStages([{ fromStage: "Interview", toStage: "Screened" }]);
  assert.equal(moved, onInterview, "EVERY active occupant moves, not just the ones we made");
  assert.equal(at("Interview"), 0, "the removed step is empty");
  assert.equal(at("Screened"), onScreened + moved, "they all landed on the destination");

  for (const id of [a, b]) {
    const events = migrationEvents(id);
    assert.equal(events.length, 1, "exactly one migration event per moved candidate");
    assert.equal(events[0].fromStage, "Interview");
    assert.equal(events[0].toStage, "Screened");
  }
  // A candidate already at the destination is untouched and gets no event — they
  // did not move, and an audit trail that says otherwise is a lie.
  assert.equal(migrationEvents(untouched).length, 0);
});

test("terminal rows are never rewritten — removing their column strands nobody", () => {
  const active = entryAt("Offer");
  const rejected = entryAt("Offer");
  actOnPipelineEntry(rejected, "reject");

  const onOffer = at("Offer"); // countPipelineByStage already excludes terminal rows
  const moved = migratePipelineStages([{ fromStage: "Offer", toStage: "Screened" }]);

  assert.equal(moved, onOffer, "only ACTIVE occupants count");
  assert.equal(migrationEvents(rejected).length, 0, "closed history is not rewritten");
  assert.equal(migrationEvents(active).length, 1);
});

test("several legs apply in one call; an empty leg is a silent no-op", () => {
  const x = entryAt("Interview");
  const y = entryAt("Offer");
  const expected = at("Interview") + at("Offer");
  const onAccepted = at("Accepted");

  const moved = migratePipelineStages([
    { fromStage: "Interview", toStage: "Accepted" },
    { fromStage: "Offer", toStage: "Accepted" },
    // Nobody is here: a caller may pass a mapping it computed optimistically.
    { fromStage: "Nonexistent step", toStage: "Accepted" },
  ]);
  assert.equal(moved, expected);
  assert.equal(at("Interview"), 0);
  assert.equal(at("Offer"), 0);
  assert.equal(at("Accepted"), onAccepted + moved);
  for (const id of [x, y]) assert.equal(migrationEvents(id).length, 1);
});

test("a same-stage leg moves nobody and writes nothing", () => {
  const id = entryAt("Screened");
  const before = listPipelineEventsForEntry(id).length;
  assert.equal(migratePipelineStages([{ fromStage: "Screened", toStage: "Screened" }]), 0);
  assert.equal(listPipelineEventsForEntry(id).length, before, "no event for a move that did not happen");
});

test("countPipelineByStage counts only ACTIVE entries — the ones a removal would strand", () => {
  const baseline = at("Interview");
  entryAt("Interview");
  const closed = entryAt("Interview");
  actOnPipelineEntry(closed, "reject");

  assert.equal(at("Interview"), baseline + 1, "a closed candidate is not on the board, so cannot be stranded");
});
