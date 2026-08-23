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

  markRepoScanRunning(scan.id, "ws-a");
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
  const failed = failRepoScan(scan.id, "Could not clone the repository (git exited 128).", "ws-a");
  assert.equal(failed?.status, "failed");
  assert.equal(failed?.source, null, "an errored run produced a dossier by neither path");
  assert.match(failed?.error ?? "", /git exited 128/);
});

test("the failure reason is bounded so a runaway stderr cannot bloat the row", () => {
  const scan = createRepoScan({ rootPath: "/srv/apps/thing" }, "ws-a");
  const failed = failRepoScan(scan.id, "x".repeat(9000), "ws-a");
  assert.equal(failed?.error?.length, 2000);
});

test("tenancy: reads, writes and the list are all scoped", () => {
  const mine = createRepoScan({ repoUrl: "https://github.com/o/mine" }, "ws-a");
  createRepoScan({ repoUrl: "https://github.com/o/theirs" }, "ws-b");

  assert.equal(getRepoScanRecord(mine.id, "ws-b"), null, "another team's scan id must not resolve");

  // A write with the wrong tenant is a no-op, not a cross-tenant mutation.
  completeRepoScan(mine.id, { dossier: DOSSIER, source: "llm" }, "ws-b");
  assert.equal(getRepoScanRecord(mine.id, "ws-a")?.status, "queued");
  failRepoScan(mine.id, "nope", "ws-b");
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
