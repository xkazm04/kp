// The Personas run sync (sync.ts) with an injected fetchExecution - no network.
// unit-db.ts must be the first project import.
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import type { Gig, GigAttempt } from "./types.ts";
import { landingFor, syncGigAttempts, DISPATCH_INTERRUPTED_MS, readGigDeliverableFile, resolveGigDeliverable, type GigSyncDeps } from "./sync.ts";
import { mkdtempSync, writeFileSync, utimesSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { FetchExecutionResult, GigExecutionSnapshot } from "./personas-exec.ts";
import { getGig, setGigWorkspace, transitionGig, upsertGigFromRaw } from "../db/gigs.ts";
import { createGigAttempt, getGigAttempt, setGigAttemptExecutionId, transitionGigAttempt } from "../db/gigs-attempts.ts";

after(() => cleanupUnitDb());

const FENCE = "`".repeat(3);
const GOOD_OUTPUT = [
  "Worked the issue.",
  `${FENCE}kp-deliverable`,
  JSON.stringify({
    version: 1,
    summary: "Fixed the off-by-one.",
    draftText: "PR description",
    artifacts: [{ kind: "pr", ref: "branch fix-1", title: "Fix" }],
    evidence: [{ kind: "test", command: "npm test", result: "ok", passed: true }],
    disclosure: "Prepared with AI assistance, reviewed by me.",
    confidence: 0.8,
    questions: [],
  }),
  FENCE,
].join("\n");

let seq = 0;
/** A gig in `dispatched` with one attempt; `executionId` null leaves it unstamped. */
function inFlight(ws: string, executionId: string | null = `exec-${seq + 1}`): { gig: Gig; attempt: GigAttempt } {
  seq += 1;
  const { gig } = upsertGigFromRaw(ws, {
    sourceId: "gsrc-s",
    arena: "oss_bounty",
    raw: {
      externalKey: `s-${seq}`,
      url: `https://example.test/s/${seq}`,
      title: `Sync ${seq}`,
      org: null,
      reward: null,
      deadlineAt: null,
      postedAt: null,
      bodyText: "Do it.",
      bodyHtml: null,
      tags: [],
    },
    suspectReasons: [],
  });
  assert.ok(transitionGig(ws, gig.id, { from: "new", to: "qualified" }).ok);
  assert.ok(transitionGig(ws, gig.id, { from: "qualified", to: "dispatched" }).ok);
  const attempt = createGigAttempt(ws, { gigId: gig.id, specialistId: "gspec-s", revisionNote: null })!;
  const stamped = executionId ? setGigAttemptExecutionId(ws, attempt.id, executionId)! : attempt;
  return { gig: getGig(ws, gig.id)!, attempt: stamped };
}

function snapshot(status: string, outputData: string | null = null, costUsd: number | null = null): FetchExecutionResult {
  const execution: GigExecutionSnapshot = { status, outputData, costUsd, errorMessage: null };
  return { ok: true, execution };
}

function deps(map: Record<string, FetchExecutionResult>, now?: Date): GigSyncDeps & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    fetchExecution: async (id) => {
      asked.push(id);
      return map[id] ?? { ok: false, reason: "personas_unreachable", retryable: true };
    },
    ...(now ? { now: () => now } : {}),
  };
}

test("the status table: every Personas word lands where the header says", () => {
  assert.deepEqual(landingFor("queued", null, null), { kind: "none" });
  assert.deepEqual(landingFor("pending", null, null), { kind: "none" });
  assert.deepEqual(landingFor("running", null, null), { kind: "running" });
  assert.equal(landingFor("completed", GOOD_OUTPUT, 1).kind, "drafted");
  assert.equal(landingFor("Completed", "no block", 1).kind, "drafted", "completed always tries the parse (failure decided later)");
  assert.equal(landingFor("incomplete", GOOD_OUTPUT, null).kind, "drafted");
  assert.deepEqual(landingFor("incomplete", "cut off", 0.5), { kind: "failed", reason: "personas_incomplete", costUsd: 0.5 });
  assert.deepEqual(landingFor("failed", null, 0.1), { kind: "failed", reason: "personas_failed", costUsd: 0.1 });
  assert.deepEqual(landingFor("cancelled", null, null), { kind: "failed", reason: "personas_cancelled", costUsd: null });
  assert.deepEqual(landingFor("teleported", null, null), { kind: "none" });
});

test("completed with a deliverable: attempt drafted with deliverable + cost, gig dispatched -> drafted", async () => {
  const ws = "ws-sync-ok";
  const { gig, attempt } = inFlight(ws);
  const s = await syncGigAttempts(ws, deps({ [attempt.executionId!]: snapshot("completed", GOOD_OUTPUT, 0.37) }));
  assert.equal(s.drafted, 1);
  const a = getGigAttempt(ws, attempt.id)!;
  assert.equal(a.status, "drafted");
  assert.equal(a.deliverable?.summary, "Fixed the off-by-one.");
  assert.equal(a.costUsd, 0.37);
  assert.equal(a.fallbackReason, null);
  assert.equal(getGig(ws, gig.id)!.status, "drafted");
});

test("completed without a block: attempt failed no_deliverable_block, cost still recorded, gig back to qualified", async () => {
  const ws = "ws-sync-noblock";
  const { gig, attempt } = inFlight(ws);
  const s = await syncGigAttempts(ws, deps({ [attempt.executionId!]: snapshot("completed", "I did things.", 1.2) }));
  assert.equal(s.failed, 1);
  const a = getGigAttempt(ws, attempt.id)!;
  assert.equal(a.status, "failed");
  assert.equal(a.fallbackReason, "no_deliverable_block");
  assert.equal(a.costUsd, 1.2);
  assert.equal(getGig(ws, gig.id)!.status, "qualified");
});

test("completed with a broken block: invalid_json; with no output: no_output", async () => {
  const ws = "ws-sync-bad";
  const one = inFlight(ws);
  const two = inFlight(ws);
  await syncGigAttempts(
    ws,
    deps({
      [one.attempt.executionId!]: snapshot("completed", `${FENCE}kp-deliverable\n{nope\n${FENCE}`),
      [two.attempt.executionId!]: snapshot("completed", null),
    })
  );
  assert.equal(getGigAttempt(ws, one.attempt.id)!.fallbackReason, "invalid_json");
  assert.equal(getGigAttempt(ws, two.attempt.id)!.fallbackReason, "no_output");
});

test("running moves dispatched -> running once; queued changes nothing; cost is not stored mid-run", async () => {
  const ws = "ws-sync-running";
  const run = inFlight(ws);
  const queued = inFlight(ws);
  const d = deps({ [run.attempt.executionId!]: snapshot("running", null, 0.05), [queued.attempt.executionId!]: snapshot("queued") });
  const s1 = await syncGigAttempts(ws, d);
  assert.equal(s1.running, 1);
  assert.equal(s1.unchanged, 1);
  assert.equal(getGigAttempt(ws, run.attempt.id)!.status, "running");
  assert.equal(getGigAttempt(ws, run.attempt.id)!.costUsd, null);
  assert.equal(getGigAttempt(ws, queued.attempt.id)!.status, "dispatched");
  const s2 = await syncGigAttempts(ws, d);
  assert.equal(s2.running, 0, "already running is not re-counted");
  assert.equal(getGig(ws, run.gig.id)!.status, "dispatched", "the gig waits while the run runs");
});

test("a running attempt that then completes lands as drafted", async () => {
  const ws = "ws-sync-run-then-done";
  const { gig, attempt } = inFlight(ws);
  await syncGigAttempts(ws, deps({ [attempt.executionId!]: snapshot("running") }));
  await syncGigAttempts(ws, deps({ [attempt.executionId!]: snapshot("completed", GOOD_OUTPUT, null) }));
  const a = getGigAttempt(ws, attempt.id)!;
  assert.equal(a.status, "drafted");
  assert.equal(a.costUsd, null, "unreported cost stays null (not free)");
  assert.equal(getGig(ws, gig.id)!.status, "drafted");
});

test("failed / cancelled / incomplete-without-block fail the attempt with their reason", async () => {
  const ws = "ws-sync-fail";
  const f = inFlight(ws);
  const c = inFlight(ws);
  const i = inFlight(ws);
  const s = await syncGigAttempts(
    ws,
    deps({
      [f.attempt.executionId!]: snapshot("failed", null, 0.2),
      [c.attempt.executionId!]: snapshot("cancelled"),
      [i.attempt.executionId!]: snapshot("incomplete", "ran out of turns"),
    })
  );
  assert.equal(s.failed, 3);
  assert.equal(getGigAttempt(ws, f.attempt.id)!.fallbackReason, "personas_failed");
  assert.equal(getGigAttempt(ws, f.attempt.id)!.costUsd, 0.2);
  assert.equal(getGigAttempt(ws, c.attempt.id)!.fallbackReason, "personas_cancelled");
  assert.equal(getGigAttempt(ws, i.attempt.id)!.fallbackReason, "personas_incomplete");
  for (const x of [f, c, i]) assert.equal(getGig(ws, x.gig.id)!.status, "qualified");
});

test("unreachable Personas changes nothing; a 404 or 403 fails the attempt", async () => {
  const ws = "ws-sync-transport";
  const down = inFlight(ws);
  const gone = inFlight(ws);
  const scope = inFlight(ws);
  const s = await syncGigAttempts(
    ws,
    deps({
      [down.attempt.executionId!]: { ok: false, reason: "personas_unreachable", retryable: true },
      [gone.attempt.executionId!]: { ok: false, reason: "personas_execution_missing", retryable: false, status: 404 },
      [scope.attempt.executionId!]: { ok: false, reason: "personas_scope_missing", retryable: false, status: 403 },
    })
  );
  assert.equal(s.unreachable, 1);
  assert.equal(s.failed, 2);
  assert.equal(getGigAttempt(ws, down.attempt.id)!.status, "dispatched");
  assert.equal(getGigAttempt(ws, gone.attempt.id)!.fallbackReason, "personas_execution_missing");
  assert.equal(getGigAttempt(ws, scope.attempt.id)!.fallbackReason, "personas_scope_missing");
});

test("an unknown status word is counted and written nowhere", async () => {
  const ws = "ws-sync-unknown";
  const { attempt } = inFlight(ws);
  const s = await syncGigAttempts(ws, deps({ [attempt.executionId!]: snapshot("paused_by_moon") }));
  assert.equal(s.unknown, 1);
  assert.equal(getGigAttempt(ws, attempt.id)!.status, "dispatched");
});

test("an attempt discarded while its run finished stays discarded (stale, not forced)", async () => {
  const ws = "ws-sync-stale";
  const { attempt } = inFlight(ws);
  // Simulate the operator's discard landing between the list and the write.
  const d: GigSyncDeps = {
    fetchExecution: async () => {
      assert.ok(transitionGigAttempt(ws, attempt.id, { from: "dispatched", to: "failed", patch: { fallbackReason: "operator" } }).ok);
      return snapshot("completed", GOOD_OUTPUT, 1);
    },
  };
  const s = await syncGigAttempts(ws, d);
  assert.equal(s.stale, 1);
  assert.equal(getGigAttempt(ws, attempt.id)!.fallbackReason, "operator");
});

test("an unstamped dispatched attempt is left alone until it is old, then failed dispatch_interrupted", async () => {
  const ws = "ws-sync-interrupted";
  const { gig, attempt } = inFlight(ws, null);
  const d0 = deps({});
  const young = await syncGigAttempts(ws, d0);
  assert.equal(young.unchanged, 1);
  assert.deepEqual(d0.asked, [], "nothing to ask Personas without an execution id");
  const later = new Date(Date.parse(attempt.createdAt) + DISPATCH_INTERRUPTED_MS + 1000);
  const old = await syncGigAttempts(ws, deps({}, later));
  assert.equal(old.failed, 1);
  assert.equal(getGigAttempt(ws, attempt.id)!.fallbackReason, "dispatch_interrupted");
  assert.equal(getGig(ws, gig.id)!.status, "qualified");
});

test("a sync only touches its own workspace", async () => {
  const mine = inFlight("ws-sync-mine");
  const theirs = inFlight("ws-sync-theirs");
  const d = deps({ [mine.attempt.executionId!]: snapshot("running"), [theirs.attempt.executionId!]: snapshot("running") });
  await syncGigAttempts("ws-sync-mine", d);
  assert.deepEqual(d.asked, [mine.attempt.executionId]);
  assert.equal(getGigAttempt("ws-sync-theirs", theirs.attempt.id)!.status, "dispatched");
});

// ---- the deliverable file (Personas can replace kp's prompt and append its own protocol after
// the model's last words, so the specialist also writes kp-deliverable.json at its folder root)

const GOOD_OBJECT = {
  version: 1,
  summary: "Wrote the report.",
  draftText: "Proposal text",
  artifacts: [{ kind: "file", ref: "deliverable/report.md", title: "Report" }],
  evidence: [],
  disclosure: "Prepared with AI assistance, reviewed by me.",
  confidence: 0.7,
  questions: [],
};

test("resolveGigDeliverable: the output's block wins; the file is read only when the output has none", () => {
  let reads = 0;
  const read = () => {
    reads += 1;
    return JSON.stringify(GOOD_OBJECT);
  };
  const fromOutput = resolveGigDeliverable(GOOD_OUTPUT, "/w", "2026-01-01T00:00:00Z", read);
  assert.ok(fromOutput.ok);
  assert.equal(fromOutput.source, "output");
  assert.equal(reads, 0, "a valid block never touches the folder");

  const fromFile = resolveGigDeliverable("{\"user_message\": {}}", "/w", "2026-01-01T00:00:00Z", read);
  assert.ok(fromFile.ok);
  assert.equal(fromFile.source, "file");
  if (fromFile.ok) assert.equal(fromFile.deliverable.summary, "Wrote the report.");

  const noWorkdir = resolveGigDeliverable("no block", null, "2026-01-01T00:00:00Z", read);
  assert.deepEqual(noWorkdir, { ok: false, reason: "no_deliverable_block" }, "no folder: the output's own reason");

  const noFile = resolveGigDeliverable("no block", "/w", "2026-01-01T00:00:00Z", () => null);
  assert.deepEqual(noFile, { ok: false, reason: "no_deliverable_block" });

  const badJson = resolveGigDeliverable("no block", "/w", "2026-01-01T00:00:00Z", () => "{nope");
  assert.equal(badJson.ok, false);
  if (!badJson.ok) {
    assert.equal(badJson.reason, "invalid_json");
    assert.match(badJson.detail ?? "", /^kp-deliverable\.json: /);
  }

  // The shape the 2026-09-25 dry run's agent improvised: no version, no disclosure.
  const improvised = resolveGigDeliverable("no block", "/w", "2026-01-01T00:00:00Z", () =>
    JSON.stringify({ contract: "kp-deliverable.v1", summary: "s", draftText: "d", artifacts: [] })
  );
  assert.equal(improvised.ok, false);
  if (!improvised.ok) {
    assert.equal(improvised.reason, "invalid_shape");
    assert.match(improvised.detail ?? "", /kp-deliverable\.json: .*version/);
  }
});

test("readGigDeliverableFile: a regular file written after the attempt started; older, absent or oversized is null", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "kp-deliv-"));
  const file = path.join(dir, "kp-deliverable.json");
  assert.equal(readGigDeliverableFile(dir, "2026-01-01T00:00:00Z"), null, "absent");

  writeFileSync(file, JSON.stringify(GOOD_OBJECT));
  const written = new Date();
  assert.ok(readGigDeliverableFile(dir, new Date(written.getTime() - 60_000).toISOString()), "newer than the attempt");

  const old = new Date(written.getTime() - 3_600_000);
  utimesSync(file, old, old);
  assert.equal(readGigDeliverableFile(dir, new Date(written.getTime() - 60_000).toISOString()), null, "an earlier attempt's file is never this attempt's draft");

  const asDir = mkdtempSync(path.join(tmpdir(), "kp-deliv-dir-"));
  mkdirSync(path.join(asDir, "kp-deliverable.json"));
  assert.equal(readGigDeliverableFile(asDir, "2026-01-01T00:00:00Z"), null, "a directory is not a deliverable");

  const big = mkdtempSync(path.join(tmpdir(), "kp-deliv-big-"));
  writeFileSync(path.join(big, "kp-deliverable.json"), "x".repeat(512 * 1024 + 1));
  assert.equal(readGigDeliverableFile(big, "2026-01-01T00:00:00Z"), null, "oversized");
});

test("completed with no block but a deliverable file in the gig folder: drafted from the file", async () => {
  const ws = "ws-sync-file";
  const { gig, attempt } = inFlight(ws);
  setGigWorkspace(ws, gig.id, { workdir: "/gigs/freelance/x" });
  const seen: string[] = [];
  const d = {
    ...deps({ [attempt.executionId!]: snapshot("completed", "Deliverables written. {\"outcome_assessment\": {}}", 0.6) }),
    readDeliverableFile: (workdir: string, notBefore: string) => {
      seen.push(`${workdir}|${notBefore}`);
      return JSON.stringify(GOOD_OBJECT);
    },
  };
  const s = await syncGigAttempts(ws, d);
  assert.equal(s.drafted, 1);
  assert.deepEqual(seen, [`/gigs/freelance/x|${attempt.createdAt}`], "read from the gig's own folder, bounded by the attempt's start");
  const a = getGigAttempt(ws, attempt.id)!;
  assert.equal(a.status, "drafted");
  assert.equal(a.deliverable?.draftText, "Proposal text");
  assert.equal(a.costUsd, 0.6);
  assert.equal(getGig(ws, gig.id)!.status, "drafted");
});
