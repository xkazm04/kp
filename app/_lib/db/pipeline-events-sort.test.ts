// Server-side ordering for the decision log's sortable table.
//
// The audit trail is server-paged, so the sort has to happen in SQL — a
// client-side comparator would only reorder the 20 rows already on screen and
// silently claim to have ranked the whole trail.
//
// Runs against an ISOLATED throwaway DB (testing/unit-db.ts must stay the first
// project import).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { ensureDb, recordEvent } from "./core.ts";
import { isPipelineEventSortColumn, listPipelineEvents } from "./pipeline.ts";

after(() => cleanupUnitDb());

// Deliberately out of order, with a shared timestamp and a null label, so each
// rule below has something to bite on.
const FIXTURES = [
  { candidateLabel: "Cara", jobTitle: "Backend", kind: "advanced", createdAt: "2026-01-03T10:00:00.000Z" },
  { candidateLabel: "Alice", jobTitle: "Frontend", kind: "auto_rejected", createdAt: "2026-01-01T10:00:00.000Z" },
  { candidateLabel: null, jobTitle: null, kind: "role_closed", createdAt: "2026-01-02T10:00:00.000Z" },
  { candidateLabel: "Bob", jobTitle: "Backend", kind: "advanced", createdAt: "2026-01-02T10:00:00.000Z" },
];

// A dedicated tenant for the fixtures: the throwaway DB self-seeds the demo
// corpus, so an unscoped query returns hundreds of seeded events alongside
// these four and every ordering assertion below would be about the seed.
// Scoping also exercises the workspace filter for free.
const WS = "sort-test-ws";
const db = ensureDb();
for (const f of FIXTURES) {
  recordEvent(db, {
    workspaceId: WS,
    entryId: null,
    candidateLabel: f.candidateLabel,
    jobTitle: f.jobTitle,
    kind: f.kind,
    detail: null,
    createdAt: f.createdAt,
  });
}

const labels = (rows: { candidateLabel: string | null }[]) => rows.map((r) => r.candidateLabel);

test("the sort column is an allowlist, not a passthrough", () => {
  // The value arrives from a query param and lands in ORDER BY, where a binding
  // cannot stand in for an identifier — so this guard IS the injection defence.
  assert.equal(isPipelineEventSortColumn("createdAt"), true);
  assert.equal(isPipelineEventSortColumn("candidateLabel"), true);
  assert.equal(isPipelineEventSortColumn("detail"), false, "not offered as a column");
  assert.equal(isPipelineEventSortColumn("created_at"), false, "the SQL name is not the API name");
  assert.equal(isPipelineEventSortColumn("id; DROP TABLE pipeline_events"), false);
  assert.equal(isPipelineEventSortColumn(null), false);
});

test("defaults to newest first when no sort is given", () => {
  const rows = listPipelineEvents(10, 0, undefined, WS);
  assert.equal(rows[0].createdAt, "2026-01-03T10:00:00.000Z");
});

test("orders by a text column in both directions", () => {
  const asc = listPipelineEvents(10, 0, undefined, WS, { col: "candidateLabel", dir: "asc" });
  assert.deepEqual(labels(asc).slice(0, 3), ["Alice", "Bob", "Cara"]);

  const desc = listPipelineEvents(10, 0, undefined, WS, { col: "candidateLabel", dir: "desc" });
  assert.deepEqual(labels(desc).slice(0, 3), ["Cara", "Bob", "Alice"]);
});

test("null labels sort LAST in both directions", () => {
  // SQLite would put NULL first ascending, opening the table on a page of rows
  // that are blank in the very column being sorted.
  assert.equal(labels(listPipelineEvents(10, 0, undefined, WS, { col: "candidateLabel", dir: "asc" })).at(-1), null);
  assert.equal(labels(listPipelineEvents(10, 0, undefined, WS, { col: "candidateLabel", dir: "desc" })).at(-1), null);
});

test("ties break on id, so paging cannot show a row twice or skip one", () => {
  // Bob and the board-level row share a timestamp. Without the id tiebreak the
  // two can swap between page 1 and page 2 of the same query.
  const page1 = listPipelineEvents(2, 0, undefined, WS, { col: "createdAt", dir: "desc" });
  const page2 = listPipelineEvents(2, 2, undefined, WS, { col: "createdAt", dir: "desc" });
  const ids = [...page1, ...page2].map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length, "a row appeared on both pages");
  assert.equal(ids.length, FIXTURES.length, "a row was skipped between pages");

  // And the order is reproducible across identical calls.
  const again = listPipelineEvents(2, 0, undefined, WS, { col: "createdAt", dir: "desc" });
  assert.deepEqual(again.map((r) => r.id), page1.map((r) => r.id));
});
