import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { ensureDb } from "./core.ts";
import {
  completeRepoScan,
  createRepoScan,
  failRepoScan,
  getRepoScanRecord,
  listRepoScans,
  markRepoScanRunning,
  cancelQueuedRepoScan,
} from "./repo-scans.ts";

after(() => cleanupUnitDb());

// Behavioral coverage for the App-master repo_scans store (P2): the lifecycle a
// poller actually observes (queued → running → complete|failed), tenancy isolation
// on every verb, and the two honesty rules the column set exists to hold —
// a scan that has not finished claims NO provenance, and a failed one never claims
// one either.

const DOSSIER = { source: "heuristic", size: { files: 3, sourceFiles: 2, contexts: 1 }, contexts: [], declaredGates: [] };

test("lifecycle: a fresh scan is queued with no source and no dossier", () => {
  const scan = createRepoScan({ repoUrl: "https://github.com/o/r" }, "ws-a");
  assert.equal(scan.status, "queued");
  assert.equal(scan.source, null, "a queued scan has not earned the right to claim either path");
  assert.equal(scan.dossier, null);
  assert.equal(scan.error, null);
  assert.equal(scan.rootPath, null);

  assert.equal(markRepoScanRunning(scan.id, "ws-a"), true);
  assert.equal(getRepoScanRecord(scan.id, "ws-a")?.status, "running");
  assert.equal(getRepoScanRecord(scan.id, "ws-a")?.source, null);

  const done = completeRepoScan(scan.id, { dossier: DOSSIER, source: "heuristic" }, "ws-a");
  assert.equal(done?.status, "complete");
  assert.equal(done?.source, "heuristic");
  assert.deepEqual(done?.dossier, DOSSIER);
  assert.ok(done?.updatedAt, "a finished scan stamps updatedAt");
});

test("a failed scan carries its reason and never claims a source", () => {
  const scan = createRepoScan({ rootPath: "/srv/apps/thing" }, "ws-a");
  markRepoScanRunning(scan.id, "ws-a");
  const failed = failRepoScan(scan.id, "Could not clone the repository (git exited 128).", "clone_failed", "ws-a");
  assert.equal(failed?.status, "failed");
  assert.equal(failed?.source, null, "an errored run produced a dossier by neither path");
  assert.match(failed?.error ?? "", /git exited 128/);
});

test("the failure reason is bounded so a runaway stderr cannot bloat the row", () => {
  const scan = createRepoScan({ rootPath: "/srv/apps/thing" }, "ws-a");
  markRepoScanRunning(scan.id, "ws-a");
  const failed = failRepoScan(scan.id, "x".repeat(9000), "engine_failed", "ws-a");
  assert.equal(failed?.error?.length, 2000);
});

test("tenancy: reads, writes and the list are all scoped", () => {
  const mine = createRepoScan({ repoUrl: "https://github.com/o/mine" }, "ws-a");
  createRepoScan({ repoUrl: "https://github.com/o/theirs" }, "ws-b");

  assert.equal(getRepoScanRecord(mine.id, "ws-b"), null, "another team's scan id must not resolve");

  // A write with the wrong tenant is a no-op, not a cross-tenant mutation.
  completeRepoScan(mine.id, { dossier: DOSSIER, source: "llm" }, "ws-b");
  assert.equal(getRepoScanRecord(mine.id, "ws-a")?.status, "queued");
  failRepoScan(mine.id, "nope", "unknown", "ws-b");
  assert.equal(getRepoScanRecord(mine.id, "ws-a")?.status, "queued");
  markRepoScanRunning(mine.id, "ws-b");
  assert.equal(getRepoScanRecord(mine.id, "ws-a")?.status, "queued");

  const listed = listRepoScans("ws-a");
  assert.ok(listed.every((s) => s.workspaceId === "ws-a"));
  assert.ok(listed.some((s) => s.id === mine.id));
  assert.ok(!listed.some((s) => s.repoUrl?.includes("theirs")));
});

test("a corrupted status column reads as failed, never as complete", () => {
  const scan = createRepoScan({ repoUrl: "https://github.com/o/r" }, "ws-a");
  ensureDb().prepare(`UPDATE repo_scans SET status = ? WHERE id = ?`).run("nonsense", scan.id);
  assert.equal(
    getRepoScanRecord(scan.id, "ws-a")?.status,
    "failed",
    "the safe reading of an unreadable state is 'this did not work'"
  );
});

test("an unrecognised source column reads as no claim at all", () => {
  const scan = createRepoScan({ repoUrl: "https://github.com/o/r" }, "ws-a");
  ensureDb().prepare(`UPDATE repo_scans SET source = ? WHERE id = ?`).run("agentic-superpowers", scan.id);
  assert.equal(getRepoScanRecord(scan.id, "ws-a")?.source, null);
});

// ---- Terminal states are terminal ------------------------------------------
//
// The status writers used to be blind UPDATEs: any late writer — a task the
// runner reaped and the queue retried, a duplicate handler — could flip a row
// that had already finished back to `running`, and the operator watched a
// finished scan start over. Every transition now carries the status it expects.

test("a finished scan is never flipped back to running", () => {
  const scan = createRepoScan({ rootPath: "/srv/apps/thing" }, "ws-a");
  markRepoScanRunning(scan.id, "ws-a");
  completeRepoScan(scan.id, { dossier: DOSSIER, source: "heuristic" }, "ws-a");

  assert.equal(markRepoScanRunning(scan.id, "ws-a"), false, "a late retry must not restart a complete scan");
  assert.equal(getRepoScanRecord(scan.id, "ws-a")?.status, "complete");

  const failed = createRepoScan({ rootPath: "/srv/apps/other" }, "ws-a");
  markRepoScanRunning(failed.id, "ws-a");
  failRepoScan(failed.id, "git is not available on this machine.", "git_missing", "ws-a");
  assert.equal(markRepoScanRunning(failed.id, "ws-a"), false, "a late retry must not restart a failed scan");
  assert.equal(getRepoScanRecord(failed.id, "ws-a")?.status, "failed");
});

test("re-marking a running scan as running is allowed and idempotent", () => {
  const scan = createRepoScan({ rootPath: "/srv/apps/thing" }, "ws-a");
  assert.equal(markRepoScanRunning(scan.id, "ws-a"), true);
  assert.equal(markRepoScanRunning(scan.id, "ws-a"), true, "queued|running both admit the running transition");
});

test("a scan that never started can be neither completed nor failed", () => {
  const scan = createRepoScan({ rootPath: "/srv/apps/thing" }, "ws-a");
  assert.equal(completeRepoScan(scan.id, { dossier: DOSSIER, source: "llm" }, "ws-a"), null);
  assert.equal(getRepoScanRecord(scan.id, "ws-a")?.status, "queued", "a queued row is not a result");
  assert.equal(failRepoScan(scan.id, "boom", "unknown", "ws-a"), null);
  assert.equal(getRepoScanRecord(scan.id, "ws-a")?.status, "queued");
});

test("a completed scan cannot be re-completed or overwritten with a failure", () => {
  const scan = createRepoScan({ rootPath: "/srv/apps/thing" }, "ws-a");
  markRepoScanRunning(scan.id, "ws-a");
  completeRepoScan(scan.id, { dossier: DOSSIER, source: "heuristic" }, "ws-a");

  assert.equal(completeRepoScan(scan.id, { dossier: { size: {} }, source: "llm" }, "ws-a"), null);
  assert.equal(failRepoScan(scan.id, "a late reaper", "unknown", "ws-a"), null);
  const still = getRepoScanRecord(scan.id, "ws-a");
  assert.equal(still?.status, "complete");
  assert.equal(still?.source, "heuristic", "the first result stands");
  assert.equal(still?.error, null);
});

test("a queued scan can be canceled before it ever runs", () => {
  const scan = createRepoScan({ rootPath: "/srv/apps/thing" }, "ws-a");
  const canceled = cancelQueuedRepoScan(scan.id, "The scan was canceled.", "ws-a");
  assert.equal(canceled?.status, "failed");
  assert.match(canceled?.error ?? "", /canceled/);

  // …but only from `queued`: a running scan is the runner's to finish.
  const live = createRepoScan({ rootPath: "/srv/apps/other" }, "ws-a");
  markRepoScanRunning(live.id, "ws-a");
  assert.equal(cancelQueuedRepoScan(live.id, "nope", "ws-a"), null);
  assert.equal(getRepoScanRecord(live.id, "ws-a")?.status, "running");
});

// ---- The outcome columns -----------------------------------------------------
//
// "failed" and "complete" were the whole vocabulary a row could speak: a scan that
// died because git is not installed and one that died because the clone timed out
// were the same row, and a dossier that landed on the heuristic floor after the
// agent fell back was indistinguishable from a keyless run that never had an agent.
// Both halves are recorded now, and both are narrowed on the way out.

test("a failure records its class, not only its English message", () => {
  const scan = createRepoScan({ repoUrl: "https://github.com/o/r" }, "ws-a");
  markRepoScanRunning(scan.id, "ws-a");
  const failed = failRepoScan(scan.id, "git is not available on this machine.", "git_missing", "ws-a");
  assert.equal(failed?.errorCode, "git_missing");
  // The message is still there for the log; it is the CODE the panel renders.
  assert.match(failed?.error ?? "", /git is not available/);
});

test("an unclassified failure is `unknown`, never a blank claim", () => {
  const scan = createRepoScan({ rootPath: "/srv/apps/thing" }, "ws-a");
  markRepoScanRunning(scan.id, "ws-a");
  assert.equal(failRepoScan(scan.id, "something went sideways", "unknown", "ws-a")?.errorCode, "unknown");
});

test("cancelling a queued scan lands it failed with the cancelled code", () => {
  const scan = createRepoScan({ rootPath: "/srv/apps/thing" }, "ws-a");
  const canceled = cancelQueuedRepoScan(scan.id, "The scan was canceled before it started.", "ws-a");
  assert.equal(canceled?.status, "failed");
  assert.equal(canceled?.errorCode, "cancelled", "a cancel is not an engine fault and must not read as one");
});

test("a completed scan carries the agent fallback that produced it", () => {
  const scan = createRepoScan({ rootPath: "/srv/apps/thing" }, "ws-a");
  markRepoScanRunning(scan.id, "ws-a");
  const done = completeRepoScan(
    scan.id,
    {
      dossier: DOSSIER,
      source: "heuristic",
      fallbackReason: "ClaudeCliError: Claude CLI timed out after 300s",
      fallbackClass: "agent_timeout",
    },
    "ws-a"
  );
  assert.equal(done?.fallbackClass, "agent_timeout");
  assert.match(done?.fallbackReason ?? "", /timed out/);
  assert.equal(done?.errorCode, null, "a completed scan has no failure to name");
});

test("a completed scan with no fallback claims none", () => {
  // The keyless walk is the FLOOR, not a fallback: reporting it as "the agent fell
  // back" would invent an agent failure on an install that never had an agent.
  const scan = createRepoScan({ rootPath: "/srv/apps/thing" }, "ws-a");
  markRepoScanRunning(scan.id, "ws-a");
  const done = completeRepoScan(scan.id, { dossier: DOSSIER, source: "heuristic" }, "ws-a");
  assert.equal(done?.fallbackClass, null);
  assert.equal(done?.fallbackReason, null);
});

test("a class this build has no word for reads as no claim at all", () => {
  // Written straight to the column, the way an older/newer build or a hand-edited
  // DB would: the reader must not be shown a chip whose catalog key does not exist.
  const scan = createRepoScan({ rootPath: "/srv/apps/thing" }, "ws-a");
  markRepoScanRunning(scan.id, "ws-a");
  completeRepoScan(scan.id, { dossier: DOSSIER, source: "llm" }, "ws-a");
  ensureDb()
    .prepare(`UPDATE repo_scans SET fallback_class = 'agent_took_a_nap', error_code = 'went_wrong' WHERE id = ?`)
    .run(scan.id);
  const read = getRepoScanRecord(scan.id, "ws-a");
  assert.equal(read?.fallbackClass, null);
  assert.equal(read?.errorCode, null);
});

// ---- Coalescing: two scans of one target must not pay twice -----------------
//
// The dedupe key was the per-POST scan id, so it could never coalesce: a
// double-click, or a re-scan after a failed dossier compose, cloned the repo and
// ran the in-repo agent twice and threw one dossier away. `claimRepoScan` is the
// read→compute→write that fixes it, and it takes the write lock at BEGIN
// (`.immediate()`) because the two POSTs it exists to merge arrive milliseconds
// apart — a plain read-then-insert would mint two rows and orphan one at `queued`.

test("a second scan of the same target coalesces onto the one already in flight", async () => {
  const { claimRepoScan } = await import("./repo-scans.ts");
  const first = claimRepoScan({ repoUrl: "https://github.com/acme/app" }, "ws-claim");
  assert.equal(first.reused, false, "the first scan of a target is a real scan");

  const second = claimRepoScan({ repoUrl: "https://github.com/acme/app" }, "ws-claim");
  assert.equal(second.reused, true);
  assert.equal(second.scan.id, first.scan.id, "the double-click gets the run already paid for");

  markRepoScanRunning(first.scan.id, "ws-claim");
  const third = claimRepoScan({ repoUrl: "https://github.com/acme/app" }, "ws-claim");
  assert.equal(third.reused, true, "a RUNNING scan coalesces too — that is the expensive one");
  assert.equal(third.scan.id, first.scan.id);
});

test("a complete scan inside the reuse window is answered instead of re-run", async () => {
  const { claimRepoScan, REPO_SCAN_REUSE_WINDOW_MS } = await import("./repo-scans.ts");
  const first = claimRepoScan({ rootPath: "/srv/apps/one" }, "ws-claim");
  markRepoScanRunning(first.scan.id, "ws-claim");
  completeRepoScan(first.scan.id, { dossier: DOSSIER, source: "heuristic" }, "ws-claim");

  const again = claimRepoScan({ rootPath: "/srv/apps/one" }, "ws-claim");
  assert.equal(again.reused, true);
  assert.equal(again.scan.id, first.scan.id);
  assert.equal(again.scan.status, "complete", "the caller is handed a finished scan, not a queued one");

  // Past the window the repository is assumed to have moved on: a re-scan is the
  // point, not a cache miss.
  const stale = claimRepoScan({ rootPath: "/srv/apps/one" }, "ws-claim", Date.now() + REPO_SCAN_REUSE_WINDOW_MS + 1_000);
  assert.equal(stale.reused, false);
  assert.notEqual(stale.scan.id, first.scan.id);
});

test("a failed scan is never reused, and neither is another tenant's or another target's", async () => {
  const { claimRepoScan } = await import("./repo-scans.ts");
  const failed = claimRepoScan({ repoUrl: "https://github.com/acme/broken" }, "ws-claim");
  markRepoScanRunning(failed.scan.id, "ws-claim");
  failRepoScan(failed.scan.id, "git exited 128", "clone_failed", "ws-claim");
  const retry = claimRepoScan({ repoUrl: "https://github.com/acme/broken" }, "ws-claim");
  assert.equal(retry.reused, false, "retrying a failure is the whole point of retrying");

  const mine = claimRepoScan({ repoUrl: "https://github.com/acme/shared" }, "ws-claim");
  const theirs = claimRepoScan({ repoUrl: "https://github.com/acme/shared" }, "ws-other");
  assert.equal(theirs.reused, false, "a scan reads a private codebase; it never crosses a tenant");
  assert.notEqual(theirs.scan.id, mine.scan.id);

  const other = claimRepoScan({ repoUrl: "https://github.com/acme/different" }, "ws-claim");
  assert.equal(other.reused, false);
});

test("a stale in-flight row stops blocking once it is past the window", async () => {
  const { claimRepoScan, REPO_SCAN_REUSE_WINDOW_MS } = await import("./repo-scans.ts");
  // A process that died mid-run leaves a `running` row nothing will ever finish.
  // Coalescing onto it forever would make one crash permanently unscannable.
  const abandoned = claimRepoScan({ rootPath: "/srv/apps/abandoned" }, "ws-claim");
  markRepoScanRunning(abandoned.scan.id, "ws-claim");
  const fresh = claimRepoScan(
    { rootPath: "/srv/apps/abandoned" },
    "ws-claim",
    Date.now() + REPO_SCAN_REUSE_WINDOW_MS + 1_000
  );
  assert.equal(fresh.reused, false);
});
