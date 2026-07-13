// Pins the bounded auto-open latch (job-postings-lifecycle #5). The bug: after an
// ingest the latch was a bare id cleared ONLY on a match, so when the "open only"
// filter hid the just-ingested DRAFT, the id never matched, the latch stayed armed,
// and a later ingest could auto-open a modal unexpectedly.
//
// Non-vacuity: the "refreshed list WITHOUT the id ⇒ clear" test is the crux — the
// pre-fix logic never returned a clear (it only opened-or-waited), so a resolver
// emulating it leaves the latch armed and that assertion fails.
//
// Runner: node --test with type stripping — npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveIngestLatch,
  ingestNeedsOpenFilterCleared,
  type IngestLatch,
} from "./job-ingest-latch.ts";
import type { Job } from "./JobsTypes.ts";

const job = (id: string, status: Job["status"] = "draft"): Job => ({ id, title: id.toUpperCase(), status });

test("no latch ⇒ wait", () => {
  assert.equal(resolveIngestLatch([job("a")], null).kind, "wait");
});

test("corpus not loaded (jobs null) ⇒ wait", () => {
  assert.equal(resolveIngestLatch(null, { id: "a", sawJobs: null }).kind, "wait");
});

test("list is still the pre-ingest array (not refreshed yet) ⇒ wait, so we don't clear early", () => {
  const list = [job("a")];
  // latch armed against `list`; the refetch hasn't returned, so jobs === sawJobs.
  const latch: IngestLatch = { id: "zzz", sawJobs: list };
  assert.equal(resolveIngestLatch(list, latch).kind, "wait");
});

test("refreshed list CONTAINS the ingested id ⇒ open that job", () => {
  const before = [job("a")];
  const after = [job("a"), job("new")]; // a fresh array — the reload landed
  const res = resolveIngestLatch(after, { id: "new", sawJobs: before });
  assert.equal(res.kind, "open");
  assert.equal(res.kind === "open" ? res.job.id : null, "new");
});

test("refreshed list WITHOUT the id (draft hidden by a filter) ⇒ clear — the latch is bounded, no stray future auto-open", () => {
  const before = [job("a")];
  const after = [job("a")]; // fresh array, still no "new" (openOnly filtered the draft out)
  assert.equal(resolveIngestLatch(after, { id: "new", sawJobs: before }).kind, "clear");
});

test("sawJobs=null resolves on the first non-null list", () => {
  const after = [job("new")];
  assert.equal(resolveIngestLatch(after, { id: "new", sawJobs: null }).kind, "open");
});

test("ingest clears the open-only filter only when it is on", () => {
  assert.equal(ingestNeedsOpenFilterCleared(true), true);
  assert.equal(ingestNeedsOpenFilterCleared(false), false);
});
