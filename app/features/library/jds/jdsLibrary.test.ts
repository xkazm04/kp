// Pins the JD-library status logic, in particular the backgrounded-analysis states
// (analyzing / failed) added for the checklist-driven generate flow: a mid-build or
// failed JD must read as such regardless of any half-ingested linked job.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { coachHandoffBlock, jdLibraryFooter, jdStatusChip, statusCategory, statusCounts, type JdRow } from "./jdsLibrary.ts";

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

test("coachHandoffBlock classifies why a coach handoff can't stage", () => {
  const rows = [
    row({ slug: "ready-1", analysis_status: "ready" }),
    row({ slug: "linked-1", jobStatus: "published" }),
    row({ slug: "build-1", analysis_status: "analyzing" }),
    row({ slug: "boom-1", analysis_status: "failed" }),
  ];
  // Editable targets (ready / linked / plain) → null: the modal auto-opens, no note.
  assert.equal(coachHandoffBlock("ready-1", rows), null);
  assert.equal(coachHandoffBlock("linked-1", rows), null);
  // Blocked builds are worded per cause.
  assert.equal(coachHandoffBlock("build-1", rows), "analyzing");
  assert.equal(coachHandoffBlock("boom-1", rows), "failed");
  // A slug with no matching row → notFound (e.g. a corpus job with no saved JD).
  assert.equal(coachHandoffBlock("ghost", rows), "notFound");
  // Still loading (rows null) or no handoff (no slug) → nothing to trace.
  assert.equal(coachHandoffBlock("build-1", null), null);
  assert.equal(coachHandoffBlock(null, rows), null);
  assert.equal(coachHandoffBlock(undefined, rows), null);
});

test("coachHandoffBlock re-derives to null once an analyzing target flips ready (arm-late)", () => {
  // The parent polls `rows`; this pure derivation flips from a note to auto-open with
  // no extra machinery — the honest arm-late path the direction prefers.
  const analyzing = [row({ slug: "j", analysis_status: "analyzing" })];
  const ready = [row({ slug: "j", analysis_status: "ready" })];
  assert.equal(coachHandoffBlock("j", analyzing), "analyzing");
  assert.equal(coachHandoffBlock("j", ready), null);
});
// ---- The footer states the library's real size (wave 40 follow-up) ----------
// The ledger footer printed `entryCount` over `visible.length` while GET /api/jds
// answered a 200-row page: a workspace holding 240 non-archived JDs read "200
// entries" — a page's size presented as the library — and the Role search silently
// could not reach the other 40. The route now carries `total` (the unbounded
// jdLibraryStats count) and `truncated`; this fold decides what the footer may claim.
test("with no total there is no M to state, so the footer stays a bare count", () => {
  assert.deepEqual(jdLibraryFooter(12, null, false), { key: "entryCount", count: 12 });
  // …even when the page was cut: "12 of ?" is not a line, and inventing an M is
  // exactly the lie this fold exists to prevent.
  assert.deepEqual(jdLibraryFooter(12, null, true), { key: "entryCount", count: 12 });
  assert.deepEqual(jdLibraryFooter(0, Number.NaN, false), { key: "entryCount", count: 0 });
});

test("a whole, unfiltered library is stated plainly", () => {
  assert.deepEqual(jdLibraryFooter(8, 8, false), { key: "entryCount", count: 8 });
  assert.deepEqual(jdLibraryFooter(0, 0, false), { key: "entryCount", count: 0 });
});

test("a narrowed or cut view says N of M", () => {
  // Filters narrowed the table: the library is bigger than what is on screen.
  assert.deepEqual(jdLibraryFooter(3, 40, false), { key: "entryCountOfTotal", count: 3, total: 40 });
  // The route cut the page: 200 rows in front of a 240-JD library.
  assert.deepEqual(jdLibraryFooter(200, 240, true), { key: "entryCountOfTotal", count: 200, total: 240 });
});

test("a truncated page never reads as a complete library, whatever the numbers say", () => {
  // `truncated` is asserted independently of the arithmetic: the route SAID rows
  // were dropped, so a total that happens to equal the visible count (a stale
  // count, a delete between the two reads) must not silently claim completeness.
  assert.deepEqual(jdLibraryFooter(200, 200, true), { key: "entryCountOfTotal", count: 200, total: 200 });
  // And a total below the visible count is incoherent — never state an M smaller
  // than the N beside it.
  assert.deepEqual(jdLibraryFooter(5, 2, true), { key: "entryCountOfTotal", count: 5, total: 5 });
});
