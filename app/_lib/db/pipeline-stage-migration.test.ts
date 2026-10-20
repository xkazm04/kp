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
  closeEntriesByJobId,
  countPipelineByStage,
  createPipelineEntry,
  getPipelineEntry,
  listPipeline,
  listPipelineEventsForEntry,
  migratePipelineStages,
  setPipelineEntryStage,
  TerminalMigrationTargetError,
} from "./pipeline.ts";
import { ensureDb } from "./core.ts";
import { DEFAULT_STAGE_AXIS } from "../pipeline-stages.ts";
import { registerStageEnteredHook, type StageEnteredNotification } from "../stage-hook-registry.ts";

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

  const moved = migratePipelineStages([{ fromStage: "Interview", toStage: "Screened" }], DEFAULT_STAGE_AXIS);
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
  const moved = migratePipelineStages([{ fromStage: "Offer", toStage: "Screened" }], DEFAULT_STAGE_AXIS);

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
  ], DEFAULT_STAGE_AXIS);
  assert.equal(moved, expected);
  assert.equal(at("Interview"), 0);
  assert.equal(at("Offer"), 0);
  assert.equal(at("Accepted"), onAccepted + moved);
  for (const id of [x, y]) assert.equal(migrationEvents(id).length, 1);
});

test("a same-stage leg moves nobody and writes nothing", () => {
  const id = entryAt("Screened");
  const before = listPipelineEventsForEntry(id).length;
  assert.equal(migratePipelineStages([{ fromStage: "Screened", toStage: "Screened" }], DEFAULT_STAGE_AXIS), 0);
  assert.equal(listPipelineEventsForEntry(id).length, before, "no event for a move that did not happen");
});

test("a role-closed candidate is neither counted nor re-staged — 'terminal' means all four statuses", () => {
  // `rejected` is only one of FOUR terminal statuses (pipeline-status.ts). A
  // candidate withdrawn because the ROLE closed is equally off the board, so a
  // column that holds only them strands nobody — yet the pair-literal these two
  // queries used counted them as occupants, which made the composer refuse the
  // removal ("these steps still hold candidates") and then rewrite the closed
  // record, breaking reopen's promise to restore each candidate to the exact
  // stage they were on before the close.
  const jobId = "closed-role-job";
  const { entry } = createPipelineEntry({
    candidateId: "closed-c1",
    candidateLabel: "Closed Role Candidate",
    jobId,
    jobTitle: "Role that got filled elsewhere",
  });
  setPipelineEntryStage(entry.id, "Offer");
  const whileActive = at("Offer"); // counted, correctly: they are on the board
  assert.equal(closeEntriesByJobId(jobId), 1);
  assert.equal(getPipelineEntry(entry.id)!.status, "role_closed");
  assert.ok(!listPipeline().some((e) => e.id === entry.id), "precondition: they are NOT on the board");

  const remaining = whileActive - 1;
  assert.equal(at("Offer"), remaining, "a withdrawn candidate stops counting as standing on the column");

  assert.equal(migratePipelineStages([{ fromStage: "Offer", toStage: "Screened" }], DEFAULT_STAGE_AXIS), remaining, "only board occupants move");
  assert.equal(getPipelineEntry(entry.id)!.stage, "Offer", "the closed record keeps its pre-close stage");
  assert.equal(migrationEvents(entry.id).length, 0, "closed history is not rewritten");
});

test("countPipelineByStage counts only ACTIVE entries — the ones a removal would strand", () => {
  const baseline = at("Interview");
  entryAt("Interview");
  const closed = entryAt("Interview");
  actOnPipelineEntry(closed, "reject");

  assert.equal(at("Interview"), baseline + 1, "a closed candidate is not on the board, so cannot be stranded");
});

// ---- the terminal stage is outcome-bearing; parity with setPipelineEntryStage ----

const eventCount = (id: string) => listPipelineEventsForEntry(id).length;

test("a leg onto the terminal stage moves nobody and writes no event — also after a valid leg", () => {
  const a = entryAt("Interview");
  const b = entryAt("Offer");
  const aEvents = eventCount(a);
  const bEvents = eventCount(b);
  const onInterview = at("Interview");
  const onOffer = at("Offer");
  assert.throws(
    () =>
      migratePipelineStages(
        [
          { fromStage: "Interview", toStage: "Screened" }, // valid, and first
          { fromStage: "Offer", toStage: "Hired" },
        ],
        DEFAULT_STAGE_AXIS
      ),
    (e: unknown) => e instanceof TerminalMigrationTargetError && e.fromStage === "Offer" && e.toStage === "Hired"
  );
  assert.equal(at("Interview"), onInterview, "the valid leg did not run either");
  assert.equal(at("Offer"), onOffer);
  assert.equal(eventCount(a), aEvents);
  assert.equal(eventCount(b), bEvents);
});

test("a renamed terminal column is refused by role, not by the literal", () => {
  const id = entryAt("Interview");
  const renamed = DEFAULT_STAGE_AXIS.map((s) => (s.role === "terminal" ? { ...s, id: "Started", label: "Started" } : s));
  const before = eventCount(id);
  assert.throws(() => migratePipelineStages([{ fromStage: "Interview", toStage: "Started" }], renamed), TerminalMigrationTargetError);
  assert.equal(eventCount(id), before);
  // The old literal is an ordinary column on that axis, so it is NOT refused.
  assert.equal(migratePipelineStages([{ fromStage: "Nonexistent step", toStage: "Hired" }], renamed), 0);
});

test("a migrated entry's pending approval is cleared and updated_at is stamped", () => {
  const id = entryAt("Interview");
  const getDb = ensureDb;
  getDb()
    .prepare(`UPDATE pipeline_entries SET approval_kind = 'advance', approval_detail = 'x', updated_at = '2000-01-01T00:00:00.000Z' WHERE id = ?`)
    .run(id);
  migratePipelineStages([{ fromStage: "Interview", toStage: "Screened" }], DEFAULT_STAGE_AXIS);
  const row = getDb().prepare(`SELECT approval_kind, approval_detail, updated_at FROM pipeline_entries WHERE id = ?`).get(id) as {
    approval_kind: string | null;
    approval_detail: string | null;
    updated_at: string;
  };
  assert.equal(row.approval_kind, null);
  assert.equal(row.approval_detail, null);
  assert.notEqual(row.updated_at, "2000-01-01T00:00:00.000Z");
});

test("the arrival hook fires once per moved entry — not for a same-stage leg, an empty leg or a closed entry", () => {
  const a = entryAt("Interview");
  const b = entryAt("Interview");
  const closed = entryAt("Interview");
  actOnPipelineEntry(closed, "reject");
  const seen: StageEnteredNotification[] = [];
  registerStageEnteredHook((n) => seen.push(n));
  const onInterview = at("Interview");
  migratePipelineStages(
    [
      { fromStage: "Interview", toStage: "Screened" },
      { fromStage: "Screened", toStage: "Screened" },
      { fromStage: "Nonexistent step", toStage: "Screened" },
    ],
    DEFAULT_STAGE_AXIS
  );
  assert.equal(seen.length, onInterview, "one notification per moved entry");
  assert.ok(seen.every((n) => n.stage === "Screened" && n.workspaceId));
  const ids = seen.map((n) => n.entryId);
  assert.ok(ids.includes(a) && ids.includes(b));
  assert.ok(!ids.includes(closed), "a closed entry never arrives anywhere");
  seen.length = 0;
  migratePipelineStages([{ fromStage: "Screened", toStage: "Screened" }], DEFAULT_STAGE_AXIS);
  assert.equal(seen.length, 0);
});
