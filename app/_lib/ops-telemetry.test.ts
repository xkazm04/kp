// tailJsonl is the only thing standing between an ops request and a months-old log
// file. It reads a BOUNDED tail window rather than the whole file, and every failure
// mode below it — a missing file, a line torn in half by the window's start, a corrupt
// record — has to degrade to "fewer rows", never to a thrown 500 on a page whose health
// half could still have answered. None of that was tested.
//
// Hermetic: KP_LOG_DIR points at a temp directory, which is also what pins the OTHER
// half of this change — the reader now resolves its directory through logger.ts's
// logDir() instead of deriving `process.env.KP_LOG_DIR ?? <cwd>/tmp` a second time.
// Two independent copies of that expression is a drift the ops surface would have
// reported as a healthy "no telemetry yet".
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, appendFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const logDirPath = mkdtempSync(path.join(os.tmpdir(), "kp-ops-log-"));
process.env.KP_LOG_DIR = logDirPath;
process.env.TZ = "UTC";

const { tailJsonl, analyzeTelemetry, commsTelemetry } = await import("./ops-telemetry.ts");
const { logDir } = await import("./logger.ts");

const line = (o: Record<string, unknown>) => JSON.stringify(o) + "\n";

test("the reader and the writer resolve the SAME log directory", () => {
  assert.equal(logDir(), logDirPath, "one logDir(), consumed by both halves");
});

test("tailJsonl degrades to [] for a log that does not exist yet", () => {
  assert.deepEqual(tailJsonl("never-written.log"), [], "a fresh workspace is empty, not an error");
});

test("tailJsonl returns at most maxLines, newest last", () => {
  const f = path.join(logDirPath, "counted.log");
  writeFileSync(f, "");
  for (let i = 0; i < 50; i++) appendFileSync(f, line({ n: i }));
  const out = tailJsonl("counted.log", 10);
  assert.equal(out.length, 10, "the cap is honoured");
  assert.deepEqual(
    out.map((r) => r.n),
    [40, 41, 42, 43, 44, 45, 46, 47, 48, 49],
    "and it is the TAIL — the newest records, in order",
  );
});

test("tailJsonl reads a bounded window and drops the line the window bisected", () => {
  // Well past the 256 KB tail window, so the read starts mid-file and its first line is
  // a fragment. A fragment must be DROPPED, never parsed and never thrown on.
  const f = path.join(logDirPath, "big.log");
  writeFileSync(f, "");
  const pad = "x".repeat(1024);
  for (let i = 0; i < 600; i++) appendFileSync(f, line({ n: i, pad }));
  const out = tailJsonl("big.log", 10_000);
  assert.ok(out.length > 0 && out.length < 600, `a bounded window, not the whole file (got ${out.length})`);
  assert.ok(
    out.every((r) => typeof r.n === "number"),
    "every returned record parsed — the bisected head line was dropped, not half-parsed",
  );
  assert.equal(out[out.length - 1].n, 599, "the newest record is still the last one");
});

test("tailJsonl skips torn and non-object lines instead of failing the whole read", () => {
  const f = path.join(logDirPath, "messy.log");
  writeFileSync(f, "");
  appendFileSync(f, line({ ok: 1 }));
  appendFileSync(f, "{not json at all\n");
  appendFileSync(f, "\n");
  appendFileSync(f, "42\n"); // a bare scalar is not a record
  appendFileSync(f, line({ ok: 2 }));
  assert.deepEqual(
    tailJsonl("messy.log").map((r) => r.ok),
    [1, 2],
    "the good records survive their neighbours",
  );
});

test("the week window is applied on ts, and a record with no ts is not counted in", () => {
  const now = Date.parse("2026-09-04T12:00:00.000Z");
  const f = path.join(logDirPath, "analyze.log");
  writeFileSync(f, "");
  appendFileSync(f, line({ ts: new Date(now - 86_400_000).toISOString(), cache_hit: true, duration_ms: 100 }));
  appendFileSync(f, line({ ts: new Date(now - 30 * 86_400_000).toISOString(), cache_hit: true, duration_ms: 9999 }));
  appendFileSync(f, line({ cache_hit: true, duration_ms: 9999 })); // no ts at all
  const t = analyzeTelemetry(now);
  assert.equal(t.sampled, 1, "only the record inside the week counts");
  assert.equal(t.cacheHitRatePct, 100);
  assert.equal(t.avgDurationMs, 100, "the month-old and undated rows never reach the average");
});

test("comms telemetry counts dead letters by status, not by mere presence", () => {
  const now = Date.parse("2026-09-04T12:00:00.000Z");
  const f = path.join(logDirPath, "comms.log");
  const ts = new Date(now - 3600_000).toISOString();
  writeFileSync(f, "");
  appendFileSync(f, line({ ts, status: "failed" }));
  appendFileSync(f, line({ ts, status: "sent" }));
  const t = commsTelemetry(now);
  assert.deepEqual(t, { deadLetters7d: 1, sampled: 2 }, "a future success line must not inflate the drop count");
});

test.after(() => rmSync(logDirPath, { recursive: true, force: true }));
