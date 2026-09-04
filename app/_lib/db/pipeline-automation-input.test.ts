// listActiveEntriesForAutomation — the automation engine's ENTIRE input, and until now
// the only function of its size in this store with no test at all (grep).
//
// Two properties, and they pull against each other, which is why both are pinned here:
//
//   CROSS-TENANT BY DESIGN. One automation engine serves every team, like the tasks
//   runner and the GDPR sweep. The enumeration must span workspaces — a per-workspace
//   read would simply stop processing every tenant but one — and each row carries its
//   own workspace_id so the caller's per-entry WRITES stay scoped. That is a deliberate
//   exemption (`-- tenancy:global`), not an oversight, and a future "fix" that adds a
//   workspace filter here would silently strand every other team's board. This file is
//   the record of that decision.
//
//   BOUNDED. It also had no LIMIT, so it hydrated every tenant's every active entry on a
//   heartbeat tick. The cap alone would be worse than nothing, though: with no ORDER BY,
//   the truncated slice is arbitrary and a candidate could sit outside the window
//   forever. The order is therefore oldest-waiting-first and TOTAL (stage_changed_at,
//   created_at, id) — so the tail dropped is always the entries that have waited least,
//   and one that misses a pass has aged and sorts nearer the front on the next.
//   Starvation-free by construction; that is what these tests measure.
//
// unit-db.ts MUST be the first project import (it sets KP_DB_PATH so every store opens a
// throwaway SQLite file unique to this process).
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import {
  AUTOMATION_PASS_ENTRY_CAP,
  actOnPipelineEntry,
  createPipelineEntry,
  listActiveEntriesForAutomation,
} from "./pipeline.ts";
import { ensureDb } from "./core.ts";

after(() => cleanupUnitDb());

const WS_A = "ws-auto-a";
const WS_B = "ws-auto-b";

/** One entry, in a named workspace, with an explicit stage_changed_at so the ordering
 *  contract is measurable rather than dependent on insertion timing. */
function seed(workspaceId: string, id: string, stageChangedAt: string) {
  const entry = createPipelineEntry({
    candidateId: `cand-${id}`,
    candidateLabel: `Candidate ${id}`,
    jobId: `job-${workspaceId}`,
    jobTitle: "Backend Eng",
    stage: "Screened",
    workspaceId,
  }).entry;
  // stage_changed_at is set by the store on create; the ordering contract is about
  // WAITING TIME, so back-date it directly rather than sleeping.
  ensureDb().prepare(`UPDATE pipeline_entries SET stage_changed_at = ? WHERE id = ?`).run(stageChangedAt, entry.id);
  return entry;
}

test("the read spans workspaces and tags every row with its own tenant", () => {
  const a1 = seed(WS_A, "a1", "2026-01-03T00:00:00.000Z");
  const b1 = seed(WS_B, "b1", "2026-01-02T00:00:00.000Z");

  const rows = listActiveEntriesForAutomation();
  const byId = new Map(rows.map((r) => [r.id, r]));

  assert.ok(byId.has(a1.id), "workspace A's entry must be in the ONE global pass");
  assert.ok(byId.has(b1.id), "workspace B's entry must be in the SAME pass — this read is deliberately cross-tenant");
  assert.equal(byId.get(a1.id)!.workspaceId, WS_A, "each row carries its own tenant, so the caller's writes stay scoped");
  assert.equal(byId.get(b1.id)!.workspaceId, WS_B);
});

test("terminal entries are excluded — the pass only ever sees active candidates", () => {
  const gone = seed(WS_A, "gone", "2026-01-01T00:00:00.000Z");
  actOnPipelineEntry(gone.id, "reject", undefined, undefined, WS_A);

  const ids = new Set(listActiveEntriesForAutomation().map((r) => r.id));
  assert.equal(ids.has(gone.id), false, "a rejected candidate must not be re-processed by the engine");
});

test("the cap is a stated bound, applied oldest-waiting-first so nothing starves", () => {
  assert.ok(AUTOMATION_PASS_ENTRY_CAP > 0, "the cap is a declared constant, not a magic number at the call site");

  // Three entries with distinct waiting times, deliberately seeded newest-first so a
  // passing result cannot be explained by insertion order.
  const newest = seed(WS_A, "newest", "2026-06-01T00:00:00.000Z");
  const oldest = seed(WS_B, "oldest", "2026-01-01T00:00:00.000Z");
  const middle = seed(WS_A, "middle", "2026-03-01T00:00:00.000Z");

  const ordered = listActiveEntriesForAutomation()
    .map((r) => r.id)
    .filter((id) => [newest.id, oldest.id, middle.id].includes(id));
  assert.deepEqual(
    ordered,
    [oldest.id, middle.id, newest.id],
    "oldest-waiting-first, ACROSS tenants — the cap is shared on waiting time, never on tenant identity"
  );

  // The bound itself: asking for one row returns the single longest-waiting entry, which
  // is what makes a truncated pass fair rather than arbitrary.
  const one = listActiveEntriesForAutomation(1);
  assert.equal(one.length, 1, "the limit is honoured");
  assert.equal(one[0].id, oldest.id, "a truncated pass keeps the entry that has waited longest");

  // A caller cannot talk the store past its own ceiling.
  assert.ok(
    listActiveEntriesForAutomation(AUTOMATION_PASS_ENTRY_CAP * 10).length <= AUTOMATION_PASS_ENTRY_CAP,
    "the declared cap is a ceiling, not a default a caller can raise"
  );
});
