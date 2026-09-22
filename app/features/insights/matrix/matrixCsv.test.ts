import { test } from "node:test";
import assert from "node:assert/strict";
import { matrixCsvRows } from "@/app/features/insights/matrix/matrixCsv";
import { toCsv } from "@/app/_lib/export-utils";

test("matrix CSV names blocked gates and retains invalid jobs after the grid", () => {
  const rows = [{ cand: { id: "c1", label: "Ada", archetype: null }, ri: 0 }];
  const cols = [{ i: 0, p: { id: "j1", title: "Engineer", seniority: "", roleFamily: "" } }];
  const csv = matrixCsvRows(
    { cells: [[{ score: null, blocked: true, koKeys: ["language"] }]], missingJobs: [{ id: "j2", error: "Invalid requirements" }] },
    rows,
    cols,
    { candidate: "Candidate", missingJobId: "Missing job ID", missingJobError: "Reason" },
    (cell) => `Blocked: ${cell.koKeys?.join(", ")}`,
  );
  assert.deepEqual(csv, [
    ["Candidate", "Engineer"],
    ["Ada", "Blocked: language"],
    [],
    ["Missing job ID", "Reason"],
    ["j2", "Invalid requirements"],
  ]);
  assert.match(toCsv(csv), /Ada,Blocked: language\r\n\r\nMissing job ID,Reason/);
});

test("matrix CSV exports assessed scores and a dash for unscored cells", () => {
  const rows = [{ cand: { id: "c1", label: "Ada", archetype: null }, ri: 0 }];
  const cols = [
    { i: 0, p: { id: "j1", title: "One", seniority: "", roleFamily: "" } },
    { i: 1, p: { id: "j2", title: "Two", seniority: "", roleFamily: "" } },
  ];
  const csv = matrixCsvRows(
    { cells: [[{ score: 75, blocked: false }, { score: null, blocked: false }]], missingJobs: [] },
    rows, cols, { candidate: "Candidate", missingJobId: "ID", missingJobError: "Reason" }, () => "Blocked",
  );
  assert.deepEqual(csv, [["Candidate", "One", "Two"], ["Ada", 75, "–"]]);
});
