// The Pipeline→Jobs deep link (`?tab=jobs&job=<id>`) and the just-ingested auto-open
// latch. Both are auto-opening behaviours driven by a URL and a background refetch —
// the kind that fails silently and is noticed weeks later — and neither had a test.
//
// The hook needs a React renderer this repo does not carry, and its one pure
// collaborator (`resolveIngestLatch`) is pinned separately, so the contracts asserted
// here are asserted at the source. CRLF-normalised first: this checkout is CRLF while
// the worktree may be LF, and `^`/`$` anchors would otherwise pass in one and fail in
// the other.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { resolveIngestLatch } from "./jobsIngestLatch.ts";

const dir = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(dir, "jobsTabDeepLink.ts"), "utf8").replace(/\r\n/g, "\n");
// Comments carry the reasoning and mention every shape the code once had, so a
// regex over raw source would match prose. Strip them before asserting on CODE.
const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

test("the deep link is applied once per param value, not once per corpus refetch", () => {
  // The render-time 'adjust state when a prop changes' shape: a list refetch must
  // not re-open a modal the user already closed.
  assert.match(code, /jobParam !== appliedJobParam/, "the guard compares the param against the one already applied");
  assert.match(code, /setAppliedJobParam\(jobParam\)/, "…and stamps it before acting");
  assert.ok(!/useEffect\(\(\) => \{\s*if \(jobs && jobParam/.test(code), "the guard stays render-time, not an effect");
});

test("a deep-link miss is point-fetched instead of silently doing nothing", () => {
  // The list is a ranked LIMIT-300 slice narrowed further by the active filters, so
  // a perfectly real role can be absent from `jobs`.
  assert.match(code, /setLookupId\(jobParam\)/, "a miss in the loaded page schedules a lookup");
  assert.match(code, /fetch\(`\/api\/jobs\/\$\{encodeURIComponent\(lookupId\)\}`\)/, "…by id, encoded, not interpolated raw");
});

test("only a 404 is told to the user as 'no such role'", () => {
  // A 5xx or a dropped connection is NOT evidence the role is gone — it used to be
  // rendered as "isn't in your catalog… may have been removed", a claim about the
  // catalog the client had never established.
  assert.match(code, /missed: r\.status === 404/, "the miss flag is derived from 404 alone");
  assert.match(code, /payload\?\.missed[\s\S]{0,40}setLookupMissed\(true\)/, "…and only that flag raises the notice");
  const catchBody = code.slice(code.lastIndexOf(".catch("));
  assert.ok(!/setLookupMissed\(true\)/.test(catchBody), "a transport failure must never claim the role is gone");
});

test("the lookup drops its result when the tab has moved on", () => {
  assert.match(code, /let cancelled = false/, "the lookup effect tracks its own cancellation");
  assert.match(code, /if \(cancelled\) return/, "…and a late response is dropped");
  assert.match(code, /return \(\) => \{\n\s*cancelled = true;/, "…set by the effect's cleanup");
});

// The latch's own contract, driven rather than read: it is armed against the jobs
// array it was created with, so it resolves on the NEXT refresh and never survives it.
// A latch that stayed armed would auto-open a modal out of nowhere minutes later.
test("the ingest latch is bounded to a single refresh", () => {
  const armedAgainst = [{ id: "old" }] as Parameters<typeof resolveIngestLatch>[0];
  const latch = { id: "fresh", sawJobs: armedAgainst };

  assert.equal(resolveIngestLatch(armedAgainst, latch).kind, "wait", "the pre-ingest list is not the refresh");

  const refreshedHit = [{ id: "old" }, { id: "fresh" }] as Parameters<typeof resolveIngestLatch>[0];
  const hit = resolveIngestLatch(refreshedHit, latch);
  assert.equal(hit.kind, "open");
  assert.equal(hit.kind === "open" ? hit.job.id : null, "fresh");

  // A refresh that does NOT contain the job (hidden by the "open only" filter, say)
  // CLEARS the latch instead of staying armed for the next one.
  assert.equal(resolveIngestLatch([{ id: "old" }, { id: "other" }] as Parameters<typeof resolveIngestLatch>[0], latch).kind, "clear");
  assert.equal(resolveIngestLatch(null, latch).kind, "wait", "an unloaded corpus is not a refresh either");
});

test("the tab arms the latch with the jobs array it was armed against", () => {
  assert.match(code, /setPendingOpen\(\{ id, sawJobs: jobs \}\)/, "the latch carries its own reference point");
});
