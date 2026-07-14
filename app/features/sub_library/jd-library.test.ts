// Pins the JD-library status logic, in particular the backgrounded-analysis states
// (analyzing / failed) added for the checklist-driven generate flow: a mid-build or
// failed JD must read as such regardless of any half-ingested linked job.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { jdStatusChip, statusCategory, statusCounts, type JdRow } from "./jd-library.ts";

const row = (over: Partial<JdRow> = {}): JdRow => ({ slug: "s", title: "T", preview: "", created_at: "2026-01-01", ...over });

test("analysis_status takes precedence over jobStatus in statusCategory", () => {
  // A backgrounded build wins even over a linked job's lifecycle status.
  assert.equal(statusCategory(row({ analysis_status: "analyzing", jobStatus: "published" })), "analyzing");
  assert.equal(statusCategory(row({ analysis_status: "failed", jobStatus: "draft" })), "failed");
  // ready / null fall through to the linked-job lifecycle (unchanged behavior).
  assert.equal(statusCategory(row({ analysis_status: "ready", jobStatus: "published" })), "live");
  assert.equal(statusCategory(row({ analysis_status: null, jobStatus: "draft" })), "draft");
  assert.equal(statusCategory(row({})), "unlinked");
});

test("jdStatusChip covers the analyzing + failed states", () => {
  // The chip carries tone + icon + category; the label is localized in the
  // component (StatusBadge) from `category`, not baked into the pure function.
  const analyzing = jdStatusChip(row({ analysis_status: "analyzing" }));
  assert.equal(analyzing.category, "analyzing");
  assert.equal(analyzing.tone, "info");
  const failed = jdStatusChip(row({ analysis_status: "failed" }));
  assert.equal(failed.category, "failed");
  assert.equal(failed.tone, "critical");
});

test("statusCounts tallies analyzing rows separately", () => {
  const rows = [
    row({ analysis_status: "analyzing" }),
    row({ analysis_status: "analyzing" }),
    row({ jobStatus: "draft" }),
    row({ jobStatus: "published" }),
  ];
  const c = statusCounts(rows);
  assert.equal(c.all, 4);
  assert.equal(c.analyzing, 2);
  assert.equal(c.draft, 1);
  assert.equal(c.live, 1);
});
