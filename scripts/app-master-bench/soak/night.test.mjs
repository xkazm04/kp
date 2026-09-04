// The soak runner's reasoning, pinned.
//
//   node --test scripts/app-master-bench/soak/night.test.mjs
//   npm run test:bench-driver
//
// night.mjs is the most-revised file in this area — twenty-odd review rounds are
// written into its comments, each one a distinction somebody got wrong once:
// a timeout is not a crash, an unreadable record is not a crash, a night that
// RAN cannot also be a miss, a silent gap is not fourteen consecutive nights.
// Every one of those was defended by prose and by nothing else. This file is the
// first thing that fails when one of them is undone.
//
// Importing night.mjs runs nothing: the half that talks to Personas, kp, the
// driver and the disk lives inside `main()`, which only fires when the file is
// the process entry point.
import test from "node:test";
import assert from "node:assert/strict";
import {
  MISS_CLASSES,
  backfillRows,
  isMissClass,
  localDate,
  newRecord,
  readLogLines,
  resolveVerdict,
} from "./night.mjs";

const record = (over = {}) => ({ ...newRecord(new Date("2026-09-01T22:00:00.000Z")), ...over });

// --- the taxonomy is closed --------------------------------------------------
test("the miss taxonomy is a closed set, and the doc's classes are all in it", () => {
  // The classes the runner itself writes, plus the two only a human writes.
  for (const cls of ["bridge-down", "kp-boot-failed", "driver-timeout", "driver-crashed", "tick-died", "record-unreadable", "no-record", "unclassified", "machine"]) {
    assert.ok(isMissClass(cls), `"${cls}" is documented but not declared in MISS_CLASSES`);
  }
  assert.equal(isMissClass("timeout"), false, "a near-miss spelling must not pass — that is the whole point of the guard");
  assert.equal(isMissClass(null), false);
  assert.equal(new Set(MISS_CLASSES).size, MISS_CLASSES.length, "a class is listed twice");
});

// --- one record, one verdict -------------------------------------------------
test("a night that RAN cannot also be a miss — the observation survives as a note", () => {
  // Round 11: the driver wrote a complete record and THEN the runner watched the
  // process exit badly. The night happened. Recording it as a miss would delete
  // a real datapoint and inflate the fragility count the soak exists to measure.
  const rec = resolveVerdict(record({ ran: true, miss: "driver-timeout" }));
  assert.equal(rec.miss, null);
  assert.equal(rec.ran, true);
  assert.equal(rec.anomalies.length, 1);
  assert.match(rec.anomalies[0], /AFTER the driver had written a complete record/);
  assert.match(rec.anomalies[0], /driver-timeout/, "the observation must still name what was seen");
});

test("a night that did not run and named no reason is UNCLASSIFIED, not a guess", () => {
  // Rounds 8+9: the honest class for "no code path said why" is ignorance. A
  // named crash here would be a crash count nobody can trace to an event.
  const rec = resolveVerdict(record({ ran: false, miss: null }));
  assert.equal(rec.miss, "unclassified");
  assert.ok(isMissClass(rec.miss));
  assert.match(rec.anomalies[0], /no code path recorded WHY/);
});

test("a night that did not run and DID name a reason keeps it", () => {
  const rec = resolveVerdict(record({ ran: false, miss: "bridge-down" }));
  assert.equal(rec.miss, "bridge-down");
  assert.deepEqual(rec.anomalies, [], "nothing to add — the path already explained itself");
});

test("every finished record answers the question, whichever way it went", () => {
  // The structural invariant, over the whole cross product: ran XOR miss.
  for (const ran of [true, false]) {
    for (const miss of [null, "tick-died"]) {
      const rec = resolveVerdict(record({ ran, miss }));
      assert.ok(rec.ran === true || isMissClass(rec.miss), `ran=${ran} miss=${miss} produced neither a run nor a classified miss`);
      assert.ok(!(rec.ran === true && rec.miss !== null), `ran=${ran} miss=${miss} produced BOTH a run and a miss`);
    }
  }
});

// --- reading the log ---------------------------------------------------------
test("the log split tolerates CRLF — this runner writes on Windows", () => {
  const crlf = '{"date":"2026-09-01","night":1}\r\n{"date":"2026-09-02","night":2}\r\n';
  const lines = readLogLines(crlf);
  assert.equal(lines.length, 2);
  assert.doesNotThrow(() => lines.map((l) => JSON.parse(l)), "a CRLF log line must still parse");
  assert.equal(JSON.parse(lines.at(-1)).date, "2026-09-02");
});

test("a BLANK CRLF line is not a night", () => {
  // The bug this pins, measured against the old split: `"\r"` is truthy, so
  // `filter(Boolean)` kept it. A two-night log with one blank CRLF line counted
  // THREE nights — tonight filed as a night that never happened — and the same
  // row throws inside the backfill when it lands last, where it is swallowed as
  // "gap backfill failed" and the log quietly stops being continuous.
  const lines = readLogLines('{"date":"2026-09-01","night":1}\r\n\r\n{"date":"2026-09-02","night":2}\r\n');
  assert.equal(lines.length, 2, "a blank line is not a record");
  assert.doesNotThrow(() => lines.map((l) => JSON.parse(l)));
  assert.equal(backfillRows(lines, "2026-09-03").prior, 2, "the night count must not be inflated by whitespace");
});

test("the log split handles LF, a trailing newline, blank lines and an empty file", () => {
  assert.deepEqual(readLogLines('{"a":1}\n{"a":2}\n'), ['{"a":1}', '{"a":2}']);
  assert.deepEqual(readLogLines('{"a":1}\r\n\r\n{"a":2}'), ['{"a":1}', '{"a":2}']);
  assert.deepEqual(readLogLines(""), []);
  assert.deepEqual(readLogLines(null), []);
});

// --- calendar-gap backfill ---------------------------------------------------
test("every skipped calendar day becomes a no-record row", () => {
  // Round 7: without this, fourteen records over a month read exactly like
  // fourteen consecutive nights.
  const lines = ['{"date":"2026-09-01","night":1,"ran":true}'];
  const { rows, prior, failed } = backfillRows(lines, "2026-09-05", new Date("2026-09-05T22:00:00.000Z"));
  assert.equal(failed, false);
  assert.deepEqual(rows.map((r) => r.date), ["2026-09-02", "2026-09-03", "2026-09-04"]);
  assert.deepEqual(rows.map((r) => r.night), [2, 3, 4]);
  assert.equal(prior, 4, "tonight is night 5");
  for (const row of rows) {
    assert.equal(row.ran, false);
    assert.equal(row.miss, "no-record");
    assert.ok(isMissClass(row.miss));
    assert.equal(row.backfilled, true, "a retrospective row must be distinguishable from a lived one");
    assert.match(row.anomalies[0], /hand-classify to machine or unclassified/);
  }
});

test("a run on the very next day backfills nothing", () => {
  const { rows, prior } = backfillRows(['{"date":"2026-09-04","night":9}'], "2026-09-05");
  assert.deepEqual(rows, []);
  assert.equal(prior, 1);
});

test("a run twice in one day backfills nothing and does not go backwards", () => {
  const { rows, prior } = backfillRows(['{"date":"2026-09-05","night":9}'], "2026-09-05");
  assert.deepEqual(rows, []);
  assert.equal(prior, 1);
});

test("an empty log has no gap to fill — the first night is night 1", () => {
  const { rows, prior } = backfillRows([], "2026-09-05");
  assert.deepEqual(rows, []);
  assert.equal(prior, 0);
});

test("a record with only `at` still dates itself", () => {
  // Older rows predate the `date` field; the runner derives it from `at` rather
  // than treating them as undatable and skipping the backfill entirely.
  const at = new Date("2026-09-01T20:00:00.000Z").toISOString();
  const { rows } = backfillRows([JSON.stringify({ at, night: 1 })], localDate(new Date("2026-09-04T20:00:00.000Z")));
  assert.ok(rows.length >= 2, `expected a gap to be filled, got ${rows.length} rows`);
});

test("an unreadable last line is reported, never papered over as continuity", () => {
  const { rows, prior, failed } = backfillRows(['{"date":"2026-09-01"}', "{ this is not json"], "2026-09-05");
  assert.equal(failed, true, "the caller must be told, so it can record the anomaly");
  assert.deepEqual(rows, [], "no rows invented from a log that could not be read");
  assert.equal(prior, 2, "the lines still count — they exist, they are just not parseable");
});

// --- the date primitive ------------------------------------------------------
test("localDate is the LOCAL calendar day, zero-padded", () => {
  // A soak night starting at 23:50 local belongs to that local day, not to
  // whatever UTC says. `sv-SE` is the ISO-shaped locale, chosen for that.
  const d = new Date(2026, 8, 4, 23, 50, 0);
  assert.equal(localDate(d), "2026-09-04");
  assert.equal(localDate(new Date(2026, 0, 5, 0, 5, 0)), "2026-01-05");
});

test("a fresh record starts with no verdict and an empty anomaly list", () => {
  const rec = newRecord(new Date("2026-09-04T10:00:00.000Z"));
  assert.equal(rec.ran, false);
  assert.equal(rec.miss, null);
  assert.equal(rec.night, null);
  assert.deepEqual(rec.anomalies, []);
  assert.equal(rec.date, localDate(new Date("2026-09-04T10:00:00.000Z")));
});
