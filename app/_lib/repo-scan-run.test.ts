import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdirSync, mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { createRepoScan, getRepoScanRecord, REPO_SCAN_FALLBACK_CLASSES } from "./db/repo-scans.ts";
import { PipelineError } from "./python-runner.ts";
import {
  classifyRepoScanError,
  REPO_SCAN_PHASE,
  RepoScanFailure,
  REPO_SCAN_FENCE_STATES,
  runRepoScan,
  scratchDirFor,
  toRepoScanEnvelope,
  toRepoScanFence,
} from "./repo-scan-run.ts";

after(() => cleanupUnitDb());

// The repo-scan runner's contract, at the seams that were never covered: what it
// accepts off the CLI envelope, what class it puts on a failed row, that the phases
// it reports are the ones it can observe, and that the scratch clone is removed on
// EVERY exit — including the failing one, which is precisely the path a real clone
// test would never reach.
//
// No process is spawned here and nothing is cloned: `runRepoScan` takes its two
// external effects (clone, spawn) as injectable deps for exactly this reason.

const ENVELOPE_DOSSIER = {
  source: "heuristic",
  size: { files: 4, sourceFiles: 3, contexts: 1 },
  contexts: [],
  declaredGates: ["npm run lint"],
  stack: [],
  hotSpots: [],
  riskAreas: [],
  candidateObjectives: [],
};

function okSpawn(envelope: unknown) {
  return () => ({
    child: null as never,
    result: Promise.resolve({ stdout: JSON.stringify(envelope), stderr: "", exitCode: 0 }),
  });
}

// ---- The envelope --------------------------------------------------------------

test("a malformed envelope is refused rather than half-persisted", () => {
  assert.throws(() => toRepoScanEnvelope(null), /missing result/);
  assert.throws(() => toRepoScanEnvelope({}), /missing result/);
  assert.throws(() => toRepoScanEnvelope({ result: [] }), /missing result/);
  assert.throws(() => toRepoScanEnvelope({ result: "a dossier, honest" }), /missing result/);
  // Shaped like an envelope, not shaped like a RepoDossier.
  assert.throws(() => toRepoScanEnvelope({ result: { size: {} } }), /not a RepoDossier/);
  assert.throws(() => toRepoScanEnvelope({ result: { size: 3, contexts: [], declaredGates: [] } }), /not a RepoDossier/);
});

test("an unrecognised source reads as the WEAKER claim", () => {
  // "an agent read your repo" is the strong claim, and it must be earned. Anything
  // this build does not recognise falls to the floor.
  for (const source of ["llm-ish", "deterministic", "", undefined, 7]) {
    const e = toRepoScanEnvelope({ result: ENVELOPE_DOSSIER, source });
    assert.equal(e.source, "heuristic", `source=${String(source)}`);
  }
  assert.equal(toRepoScanEnvelope({ result: ENVELOPE_DOSSIER, source: "llm" }).source, "llm");
});

test("a fallback class outside the vocabulary reaches the row as no claim", () => {
  assert.equal(toRepoScanEnvelope({ result: ENVELOPE_DOSSIER, fallbackClass: "agent_timeout" }).fallbackClass, "agent_timeout");
  assert.equal(toRepoScanEnvelope({ result: ENVELOPE_DOSSIER, fallbackClass: "agent_had_a_think" }).fallbackClass, null);
  assert.equal(toRepoScanEnvelope({ result: ENVELOPE_DOSSIER }).fallbackClass, null);
});

// ---- The mirror ----------------------------------------------------------------

test("the TS fallback vocabulary equals the Python one, read from the source", () => {
  // Python is the SINGLE definition (it classifies where the exception was seen).
  // This reads that tuple out of the file rather than trusting two lists to have
  // been kept in step by eye — a class Python emits that TS drops is a chip that
  // silently disappears; a class TS knows that Python never emits is dead copy in
  // four catalogs.
  const here = path.dirname(fileURLToPath(import.meta.url));
  const py = readFileSync(path.join(here, "..", "..", "pipeline", "jobfit", "repo_scan.py"), "utf8");
  const block = /FALLBACK_CLASSES = \(([\s\S]*?)\)/.exec(py);
  assert.ok(block, "FALLBACK_CLASSES must still be a tuple literal in repo_scan.py");
  const fromPython = [...block[1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
  assert.ok(fromPython.length >= 5, "the parse found suspiciously few classes");
  assert.deepEqual([...fromPython].sort(), [...REPO_SCAN_FALLBACK_CLASSES].sort());
});

// ---- The failure class ---------------------------------------------------------

test("a failure is classified by what was observed, not by matching English", () => {
  assert.equal(classifyRepoScanError(new RepoScanFailure("no git", "git_missing")), "git_missing");
  assert.equal(classifyRepoScanError(new PipelineError({ message: "boom", status: 500 })), "engine_failed");
  assert.equal(classifyRepoScanError(new Error("something")), "unknown");
  assert.equal(classifyRepoScanError("not even an error"), "unknown");
});

test("an aborted run is `cancelled` whatever the killed step happened to raise", () => {
  // A SIGKILLed child reports an engine fault. Blaming the engine for the
  // operator's own Cancel is the lie this ordering prevents.
  const ac = new AbortController();
  ac.abort();
  assert.equal(classifyRepoScanError(new PipelineError({ message: "killed", status: 500 }), ac.signal), "cancelled");
  assert.equal(classifyRepoScanError(new RepoScanFailure("timed out", "clone_timeout"), ac.signal), "cancelled");
});

test("a watchdog reap is `timeout`, because it is not the operator's Cancel", () => {
  // The task runner aborts the SAME controller for both, so an abort with no reason
  // was read as a Cancel and the panel told the operator they had stopped a scan
  // they had watched for fifteen minutes. The reason is the only thing that
  // separates them, and it is the platform's own vocabulary: `AbortSignal.timeout()`
  // aborts with exactly this DOMException, so nothing here is a private protocol.
  const reaped = new AbortController();
  reaped.abort(new DOMException("exceeded the 900000ms wall-clock budget", "TimeoutError"));
  assert.equal(classifyRepoScanError(new PipelineError({ message: "killed", status: 500 }), reaped.signal), "timeout");
  assert.equal(classifyRepoScanError(new Error("git died"), reaped.signal), "timeout");

  // An operator Cancel still reads as a Cancel: `controller.abort()` with no
  // argument yields an AbortError, and every other reason is one too.
  const cancelled = new AbortController();
  cancelled.abort();
  assert.equal(classifyRepoScanError(new Error("git died"), cancelled.signal), "cancelled");
  const other = new AbortController();
  other.abort("some string reason");
  assert.equal(classifyRepoScanError(new Error("git died"), other.signal), "cancelled");
});

test("the task watchdog aborts WITH a reason and Cancel aborts without one", () => {
  // A source guard, because the alternative is a unit test that waits out
  // TASK_MAX_RUNTIME_MS. It pins the seam the classifier reads: two abort sites on
  // one controller, and only the watchdog names itself. Line endings normalised
  // first — this file is read from a CRLF checkout and an LF worktree.
  const src = readFileSync(
    fileURLToPath(new URL("./tasks.ts", import.meta.url)),
    "utf-8"
  ).replace(/\r\n/g, "\n");
  assert.match(
    src,
    /controller\.abort\(\s*new DOMException\([^)]*"TimeoutError"\s*\)\s*\)/,
    "the watchdog must abort with a TimeoutError reason, or a reap is indistinguishable from a Cancel"
  );
  assert.match(src, /export function cancelTask[\s\S]*?controller\.abort\(\);/, "Cancel aborts with no reason");
});

// ---- The run -------------------------------------------------------------------

test("a completed run lands the dossier, the source and the fallback class on the row", async () => {
  // A LOCAL scan, so it must sit inside the allow-list the runner re-checks — the
  // point of the test is the row it writes, not the refusal.
  const allowed = mkdtempSync(path.join(tmpdir(), "kp-repo-scan-test-"));
  process.env.KP_APP_MASTER_REPO_ROOTS = allowed;
  const scan = createRepoScan({ rootPath: allowed }, "ws-run");
  const phases: string[] = [];
  const result = await runRepoScan(
    { scanId: scan.id },
    undefined,
    "ws-run",
    "en",
    (_done, _total, msg) => phases.push(msg ?? ""),
    {
      spawn: okSpawn({
        result: ENVELOPE_DOSSIER,
        source: "heuristic",
        fallbackReason: { repoScan: "ClaudeCliError: Claude CLI timed out after 300s" },
        fallbackClass: "agent_timeout",
      }),
    }
  );

  assert.equal(result.record.status, "complete");
  assert.equal(result.record.source, "heuristic");
  assert.equal(result.record.fallbackClass, "agent_timeout");
  assert.match(result.record.fallbackReason ?? "", /timed out/);
  // A LOCAL scan never clones, so the clone phase is never claimed as live.
  assert.deepEqual(phases, [REPO_SCAN_PHASE.walk, REPO_SCAN_PHASE.saving, REPO_SCAN_PHASE.saving]);
});

test("a URL run reports the clone phase before the walk", async () => {
  const scan = createRepoScan({ repoUrl: "https://github.com/acme/widget" }, "ws-run");
  const phases: string[] = [];
  let clonedInto = "";
  await runRepoScan({ scanId: scan.id }, undefined, "ws-run", "en", (_d, _t, m) => phases.push(m ?? ""), {
    clone: async (_url, dest) => {
      clonedInto = dest;
      mkdirSync(dest, { recursive: true });
      writeFileSync(path.join(dest, "README.md"), "# widget\n", "utf-8");
    },
    spawn: okSpawn({ result: ENVELOPE_DOSSIER, source: "llm" }),
  });

  assert.equal(phases[0], REPO_SCAN_PHASE.clone);
  assert.equal(phases[1], REPO_SCAN_PHASE.walk);
  assert.equal(clonedInto, scratchDirFor(scan.id));
  assert.equal(existsSync(clonedInto), false, "the scratch clone does not outlive the run");
});

test("the scratch clone is removed even when the run FAILS", async () => {
  // The failing exit is the one a real-clone test never reaches, and it is the one
  // that matters: a leaked clone of somebody's private repository sits in the OS
  // temp dir until the machine is rebooted.
  const scan = createRepoScan({ repoUrl: "https://github.com/acme/widget" }, "ws-run");
  const dest = scratchDirFor(scan.id);
  await assert.rejects(
    runRepoScan({ scanId: scan.id }, undefined, "ws-run", "en", undefined, {
      clone: async (_url, d) => {
        mkdirSync(d, { recursive: true });
        writeFileSync(path.join(d, "secret.txt"), "not for the temp dir", "utf-8");
      },
      spawn: () => ({
        child: null as never,
        result: Promise.resolve({ stdout: "", stderr: "traceback", exitCode: 1 }),
      }),
    }),
    /.*/
  );
  assert.equal(existsSync(dest), false, "a failed run cleans up after itself too");

  const row = getRepoScanRecord(scan.id, "ws-run");
  assert.equal(row?.status, "failed");
  assert.equal(row?.errorCode, "engine_failed", "a Python fault is an engine fault, named as one");
});

test("a refused target fails the row as a refusal, not as an engine fault", async () => {
  // The allow-list is process env: it can narrow between a scan being queued and
  // run. The operator needs to know their own configuration refused this, not that
  // "the scan failed".
  const scan = createRepoScan({ rootPath: "/srv/apps/thing" }, "ws-run");
  const previous = process.env.KP_APP_MASTER_REPO_ROOTS;
  process.env.KP_APP_MASTER_REPO_ROOTS = path.join(process.cwd(), "nowhere-near-that-path");
  try {
    await assert.rejects(runRepoScan({ scanId: scan.id }, undefined, "ws-run", "en", undefined, { spawn: okSpawn({}) }));
  } finally {
    if (previous === undefined) delete process.env.KP_APP_MASTER_REPO_ROOTS;
    else process.env.KP_APP_MASTER_REPO_ROOTS = previous;
  }
  assert.equal(getRepoScanRecord(scan.id, "ws-run")?.errorCode, "target_refused");
});

test("a cancelled run lands `cancelled` on the row, never a row stuck at running", async () => {
  const scan = createRepoScan({ repoUrl: "https://github.com/acme/widget" }, "ws-run");
  const ac = new AbortController();
  await assert.rejects(
    runRepoScan({ scanId: scan.id }, ac.signal, "ws-run", "en", undefined, {
      clone: async (_url, dest, signal) => {
        mkdirSync(dest, { recursive: true });
        ac.abort();
        throw new RepoScanFailure(signal?.aborted ? "The scan was canceled." : "?", "cancelled");
      },
    })
  );
  const row = getRepoScanRecord(scan.id, "ws-run");
  assert.equal(row?.status, "failed");
  assert.equal(row?.errorCode, "cancelled");
  assert.equal(existsSync(scratchDirFor(scan.id)), false);
});

test("the scratch directory cannot escape its root, whatever the id says", () => {
  const root = path.join(path.sep, "tmp");
  const escaped = scratchDirFor("../../etc/passwd", root);
  assert.ok(escaped.startsWith(path.join(root, "kp-repo-scan")), escaped);
  assert.equal(scratchDirFor("///", root), path.join(root, "kp-repo-scan", "scan"));
});

// ---- The fence disclosure --------------------------------------------------------

test("the TS fence vocabulary equals the Python one, read from the source", () => {
  // Same guard as the fallback mirror above, for the same reason: Python is the one
  // that knows which CLI ran, TS is the one that narrows the answer, and a state
  // only one side knows is either a blank line on somebody's screen or dead copy in
  // four catalogs.
  const here = path.dirname(fileURLToPath(import.meta.url));
  const py = readFileSync(path.join(here, "..", "..", "pipeline", "jobfit", "repo_scan.py"), "utf8");
  const block = /^FENCE_STATES = \(([\s\S]*?)^\)/m.exec(py);
  assert.ok(block, "FENCE_STATES must still be a tuple literal in repo_scan.py");
  const fromPython = [...block[1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
  assert.deepEqual([...fromPython].sort(), [...REPO_SCAN_FENCE_STATES].sort());
});

test("an unverified fence reaches the envelope as an UNVERIFIED claim", () => {
  // The direction's whole point: the deny rules are pinned to one verified CLI
  // version in a code comment, and until now nothing noticed when the installed CLI
  // had moved past it.
  const unverified = toRepoScanEnvelope({
    result: ENVELOPE_DOSSIER,
    fence: { cliVersion: "99.0.0", state: "unverified_version", verified: true, skippedSymlinks: 2 },
  }).fence;
  assert.ok(unverified);
  assert.equal(unverified.state, "unverified_version");
  // `verified` is DERIVED from the state, so a payload claiming true cannot talk its
  // way past the narrowing.
  assert.equal(unverified.verified, false);
  assert.equal(unverified.cliVersion, "99.0.0");
  assert.equal(unverified.skippedSymlinks, 2);
});

test("a verified fence, and one with nothing to fence, both read as verified", () => {
  for (const state of ["verified", "not_applicable"] as const) {
    const fence = toRepoScanEnvelope({ result: ENVELOPE_DOSSIER, fence: { state, skippedSymlinks: 0 } }).fence;
    assert.ok(fence, state);
    assert.equal(fence.verified, true);
  }
  // A version the CLI would not report is NOT a verified fence.
  const unknown = toRepoScanEnvelope({ result: ENVELOPE_DOSSIER, fence: { state: "version_unknown" } }).fence;
  assert.equal(unknown?.verified, false);
});

test("a missing or unrecognisable fence is no claim, never a green one", () => {
  assert.equal(toRepoScanEnvelope({ result: ENVELOPE_DOSSIER }).fence, null);
  assert.equal(toRepoScanEnvelope({ result: ENVELOPE_DOSSIER, fence: "verified" }).fence, null);
  assert.equal(toRepoScanEnvelope({ result: ENVELOPE_DOSSIER, fence: { state: "probably_fine" } }).fence, null);
  assert.equal(toRepoScanFence(null), null);
  assert.equal(toRepoScanFence([{ state: "verified" }]), null);
});

test("the dossier's own scanFence block is read when the envelope has no top-level one", () => {
  // That copy is the one that survives to the row, so a build that only stamps it
  // there must still surface the disclosure.
  const fence = toRepoScanEnvelope({
    result: { ...ENVELOPE_DOSSIER, scanFence: { state: "unverified_version", cliVersion: "3.0.0", skippedSymlinks: 1 } },
  }).fence;
  assert.equal(fence?.state, "unverified_version");
  assert.equal(fence?.skippedSymlinks, 1);
});
