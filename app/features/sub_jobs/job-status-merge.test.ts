// Pins the "a lifecycle action refreshes the affected row" contract
// (job-postings-lifecycle finding #2). The bug: JobPostingModal mutated only its
// own local state, so JobsTab's JobRow kept rendering the cached job.status until
// a manual reload.
//
// Non-vacuity: the first test asserts row "b" flips published → closed while its
// siblings keep both value and object identity. Pre-fix there was NO merge/refresh
// path at all — the list was left untouched — so the equivalent "return jobs
// unchanged" behavior leaves "b" at "published" and the assertion fails.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeJobStatus } from "./job-status-merge.ts";
import type { Job } from "./JobsTypes.ts";

const job = (id: string, status: Job["status"]): Job => ({ id, title: id.toUpperCase(), status });

test("a lifecycle action flips the target row's status; siblings are untouched by value AND identity", () => {
  const list = [job("a", "published"), job("b", "published"), job("c", "draft")];
  const next = mergeJobStatus(list, "b", "closed");
  assert.equal(next?.find((j) => j.id === "b")?.status, "closed");
  assert.equal(next?.find((j) => j.id === "a")?.status, "published");
  // Only the changed row is a new object; the rest are preserved by reference.
  assert.equal(next?.[0], list[0]);
  assert.equal(next?.[2], list[2]);
  assert.notEqual(next, list);
});

test("reopen merges closed → published on the matching row", () => {
  const list = [job("a", "closed")];
  assert.equal(mergeJobStatus(list, "a", "published")?.[0]?.status, "published");
});

test("a miss (unknown id) returns the SAME list reference — no re-render", () => {
  const list = [job("a", "published")];
  assert.equal(mergeJobStatus(list, "zzz", "closed"), list);
});

test("a no-op (already that status) returns the same reference", () => {
  const list = [job("a", "closed")];
  assert.equal(mergeJobStatus(list, "a", "closed"), list);
});

test("a null list passes through unchanged", () => {
  assert.equal(mergeJobStatus(null, "a", "closed"), null);
});
