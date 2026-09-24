import { test } from "node:test";
import assert from "node:assert/strict";
import { caseStage, filterCases } from "./DevCasesTable.filter.ts";
import type { DevCaseDetail, Lifecycle, Posting } from "./DevTypes";

const cases: DevCaseDetail[] = [
  { id: "a", title: "Backend exercise", roleTitle: "Platform engineer", seniority: "senior", createdAt: "2026-09-01" },
  { id: "b", title: "Support scenario", roleTitle: "Customer support", seniority: "junior", createdAt: "2026-09-02" },
  { id: "c", title: "Design task", roleTitle: "UX designer", seniority: "medior", createdAt: "2026-09-03" },
];
const lifecycles = [{ caseId: "a", stage: "collecting" }] as Lifecycle[];
const postings = [{ caseId: "b" }] as Posting[];

test("stage filter uses the row's lifecycle, posting, and approved fallbacks", () => {
  assert.equal(caseStage("a", lifecycles, postings), "collecting");
  assert.equal(caseStage("b", lifecycles, postings), "published");
  assert.equal(caseStage("c", lifecycles, postings), "approved");
  assert.deepEqual(filterCases(cases, lifecycles, postings, { title: "", stage: "published", seniority: "" }).map((item) => item.id), ["b"]);
});

test("title matches assignment or role without case, while seniority intersects", () => {
  assert.deepEqual(filterCases(cases, lifecycles, postings, { title: "  PLATFORM ", stage: "", seniority: "senior" }).map((item) => item.id), ["a"]);
  assert.deepEqual(filterCases(cases, lifecycles, postings, { title: "support", stage: "", seniority: "senior" }), []);
  assert.deepEqual(filterCases(cases, lifecycles, postings, { title: "", stage: "", seniority: "" }), cases);
});
