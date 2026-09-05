// The repo-scan front door: what `startRepoScan` does with a target that is ALREADY
// being read, or was read a moment ago.
//
// It used to do nothing with either. Every POST minted a row and a task whose dedupe
// key was that row's own id, so a double-click — or the far more common "the compose
// failed, point kp at the same app again" — paid for a second shallow clone plus a
// second in-repo agent session over the same codebase, then discarded one of the two
// dossiers. Coalescing lives here, in front of the row, because merging the TASKS
// alone would leave the second ROW at `queued` forever and the row is what the
// operator polls.
//
// unit-db.ts must stay the first project import (isolated throwaway DB).
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { completeRepoScan, getRepoScanRecord, markRepoScanRunning } from "./db/repo-scans.ts";
import { RepoScanRequestError, startRepoScan } from "./repo-scan.ts";

after(() => {
  delete process.env.KP_APP_MASTER_REPO_ROOTS;
  cleanupUnitDb();
});

// Local paths must sit inside the allow-list `resolveScanTarget` enforces; the
// subject here is the coalescing, not the refusal.
let allowed = "";
before(() => {
  allowed = mkdtempSync(path.join(tmpdir(), "kp-repo-scan-front-"));
  process.env.KP_APP_MASTER_REPO_ROOTS = allowed;
});

test("a second POST for a target already in flight is handed that run", () => {
  const first = startRepoScan({ rootPath: allowed }, "ws-front");
  assert.equal(first.reused, false);
  assert.ok(first.taskId, "a real scan gets a task");

  const second = startRepoScan({ rootPath: allowed }, "ws-front");
  assert.equal(second.reused, true, "a double-click is one reading of one repository");
  assert.equal(second.scanId, first.scanId);
  assert.equal(second.taskId, first.taskId, "and the caller can still watch the run that is actually happening");
});

test("a completed scan inside the window is answered without spawning anything", () => {
  const scan = startRepoScan({ repoUrl: "https://github.com/acme/done" }, "ws-front");
  markRepoScanRunning(scan.scanId, "ws-front");
  completeRepoScan(scan.scanId, { dossier: { contexts: [] }, source: "heuristic" }, "ws-front");

  const again = startRepoScan({ repoUrl: "https://github.com/acme/done" }, "ws-front");
  assert.equal(again.reused, true);
  assert.equal(again.scanId, scan.scanId);
  assert.equal(again.taskId, null, "there is no run to watch — the dossier is already on the row");
  assert.equal(getRepoScanRecord(again.scanId, "ws-front")?.status, "complete");
});

test("a refused target still leaves nothing behind", () => {
  assert.throws(() => startRepoScan({ rootPath: "/etc" }, "ws-front"), RepoScanRequestError);
  assert.throws(() => startRepoScan({}, "ws-front"), RepoScanRequestError);
});
