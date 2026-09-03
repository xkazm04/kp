// Pins the ad-ingest panel's cancel-versus-unmount protocol (lot JW, wave 22).
//
// This is the trickiest teardown protocol in the jobs workspace and nothing
// referenced it. One AbortController serves TWO different events:
//   * the recruiter presses "Cancel run"  — a real terminal outcome: keep the
//     partial rows, clear busy, say how far it got, refresh if anything landed;
//   * the panel unmounts (tab switch)     — a teardown: write NOTHING, because
//     every setState would land in a dead component.
// `cancelledRef` is the only thing separating them, and before this test a
// revert of that ref (treating every abort as a teardown, the pre-fix shape)
// went unnoticed: the run could not be cancelled from the mounted panel at all.
//
// Third rule pinned here: a bulk run where NOTHING was created (`added === 0`,
// every ad a dedup hit or a parse failure) must KEEP the paste. The textarea is
// the only copy of that text; clearing it left the recruiter with nothing on
// screen to account for the vanished input.
//
// Runner: node --test with type stripping (npm run test:unit).
import { test } from "node:test";
import assert from "node:assert/strict";
import { settleBulkRun, settleSingleRun, releasesBusy, type IngestRow } from "./jobsIngestRunOutcome.ts";

const rows: IngestRow[] = [
  { title: "Backend Engineer", status: "added" },
  { title: "Data Analyst", status: "exists" },
];

test("cancel mid-bulk keeps the partial results and reports how far it got", () => {
  const s = settleBulkRun({ aborted: true, cancelled: true, rows, total: 5 });
  assert.equal(s.kind, "cancelled");
  if (s.kind !== "cancelled") return;
  assert.deepEqual(s.results, rows); // the two that landed are NOT thrown away
  assert.equal(s.done, 2);
  assert.equal(s.total, 5);
  assert.equal(s.refresh, true); // one row was created — the corpus changed
});

test("cancel mid-bulk with nothing created does not ask for a corpus refresh", () => {
  const s = settleBulkRun({
    aborted: true,
    cancelled: true,
    rows: [{ title: "Data Analyst", status: "exists" }],
    total: 4,
  });
  assert.equal(s.kind, "cancelled");
  if (s.kind !== "cancelled") return;
  assert.equal(s.refresh, false);
});

test("unmount abort is a silent teardown — no results, no note, no refresh", () => {
  const s = settleBulkRun({ aborted: true, cancelled: false, rows, total: 5 });
  assert.equal(s.kind, "teardown"); // the caller writes no state at all
});

test("a completed bulk run with added === 0 KEEPS the paste", () => {
  const s = settleBulkRun({
    aborted: false,
    cancelled: false,
    rows: [
      { title: "Data Analyst", status: "exists" },
      { title: "??", status: "failed" },
    ],
    total: 2,
  });
  assert.equal(s.kind, "done");
  if (s.kind !== "done") return;
  assert.equal(s.added, 0);
  assert.equal(s.exists, 1);
  assert.equal(s.failed, 1);
  assert.equal(s.clearPaste, false); // the textarea is the only copy of that text
  assert.equal(s.refresh, false);
});

test("a completed bulk run that created something clears the paste and refreshes", () => {
  const s = settleBulkRun({ aborted: false, cancelled: false, rows, total: 2 });
  assert.equal(s.kind, "done");
  if (s.kind !== "done") return;
  assert.equal(s.added, 1);
  assert.equal(s.clearPaste, true);
  assert.equal(s.refresh, true);
});

test("single-ad run: cancel is reported, unmount is silent", () => {
  assert.equal(settleSingleRun({ aborted: true, cancelled: true }).kind, "cancelled");
  assert.equal(settleSingleRun({ aborted: true, cancelled: false }).kind, "teardown");
  assert.equal(settleSingleRun({ aborted: false, cancelled: false }).kind, "settled");
});

test("busy is released on every outcome except an unmount teardown", () => {
  assert.equal(releasesBusy({ aborted: false, cancelled: false }), true); // normal finish
  assert.equal(releasesBusy({ aborted: true, cancelled: true }), true); // user cancel
  assert.equal(releasesBusy({ aborted: true, cancelled: false }), false); // teardown: no writes
});
