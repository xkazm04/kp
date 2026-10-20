import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateCandidateIds,
  defaultPicks,
  commitSummary,
  type CandidatePreviewRow,
} from "./devcase-source-pick.ts";

test("validateCandidateIds: rejects non-arrays, empty arrays, and invalid elements", () => {
  assert.equal(validateCandidateIds(null), null);
  assert.equal(validateCandidateIds(undefined), null);
  assert.equal(validateCandidateIds("c1"), null);
  assert.equal(validateCandidateIds(123), null);
  assert.equal(validateCandidateIds({}), null);
  assert.equal(validateCandidateIds([]), null);
  assert.equal(validateCandidateIds([""]), null);
  assert.equal(validateCandidateIds(["   "]), null);
  assert.equal(validateCandidateIds([123]), null);
  assert.equal(validateCandidateIds(["c1", 42]), null);
  assert.equal(validateCandidateIds(["c1", ""]), null);

  assert.deepEqual(validateCandidateIds(["c1"]), ["c1"]);
  assert.deepEqual(validateCandidateIds([" c1 ", "c2"]), ["c1", "c2"]);
});

test("defaultPicks: selects every row with onBoard null and no row that is on the board", () => {
  const rows: CandidatePreviewRow[] = [
    { candidateId: "p1", label: "Alice", onBoard: null },
    { candidateId: "p2", label: "Bob", onBoard: { status: "active", stage: "Accepted" } },
    { candidateId: "p3", label: "Charlie", onBoard: null },
    { candidateId: "p4", label: "Dave", onBoard: { status: "rejected", stage: "Screen" } },
    { candidateId: null, label: "Eve", onBoard: null },
  ];

  const picks = defaultPicks(rows);
  assert.deepEqual(picks, ["p1", "p3"]);
});

test("commitSummary: maps outcome to catalog key and counts correctly", () => {
  // At least 1 added -> 'filed'
  assert.deepEqual(
    commitSummary({ added: 3, alreadyOnBoard: 0, dropped: [] }),
    { key: "filed", added: 3, alreadyOnBoard: 0, dropped: 0 },
  );

  // Added with dropped -> 'filed'
  assert.deepEqual(
    commitSummary({ added: 1, alreadyOnBoard: 2, dropped: ["gone"] }),
    { key: "filed", added: 1, alreadyOnBoard: 2, dropped: 1 },
  );

  // Nothing added, already on board -> 'nothingNew'
  assert.deepEqual(
    commitSummary({ added: 0, alreadyOnBoard: 2, dropped: [] }),
    { key: "nothingNew", added: 0, alreadyOnBoard: 2, dropped: 0 },
  );

  // Nothing added, but dropped -> 'dropped'
  assert.deepEqual(
    commitSummary({ added: 0, alreadyOnBoard: 0, dropped: ["gone"] }),
    { key: "dropped", added: 0, alreadyOnBoard: 0, dropped: 1 },
  );
});
