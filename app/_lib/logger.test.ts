// Secret hygiene for the two schedule logs: the invite's CAPABILITY TOKEN must never
// reach a log line.
//
// `/schedule/<token>` is a capability link — the token IS the credential, it stays live
// after booking (it is the candidate's durable reschedule link), and logger.ts says out
// loud that a real deployment ships these files to an alerting sink. So a raw token in
// `schedule-reconcile.log` / `schedule-no-slots.log` (or in the console line that goes to
// the platform's stdout) hands anyone with log access the ability to rebook or cancel that
// candidate's interview. What the log needs is a HANDLE, not a credential: a truncated
// SHA-256 that still recognises repeat lines about the same invite, beside the `entry_id`
// the recruiter actually acts on.
//
// NON-VACUITY: with the fingerprinting removed (append `entry` verbatim / interpolate
// `entry.token`), both "the raw token must not appear" assertions fail.
//
// Hermetic: KP_LOG_DIR is redirected to a throwaway temp dir BEFORE logger.ts is imported
// (it freezes LOG_DIR at module load), and console.error is captured, so nothing is
// written to the developer's tmp/ and nothing is printed.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const LOG_DIR = mkdtempSync(path.join(os.tmpdir(), "kp-logger-test-"));
process.env.KP_LOG_DIR = LOG_DIR;
after(() => rmSync(LOG_DIR, { recursive: true, force: true }));

const { logScheduleReconcile, logScheduleNoSlots } = await import("./logger.ts");

// A stand-in for the 192-bit CSPRNG token the schedule store mints.
const TOKEN = `tok-${randomUUID()}${randomUUID()}`.replace(/-/g, "");
const FINGERPRINT = createHash("sha256").update(TOKEN).digest("hex").slice(0, 12);

/** Run `fn` with console.error captured, returning everything it printed. */
async function captureStderr(fn: () => Promise<void>): Promise<string> {
  const original = console.error;
  const lines: string[] = [];
  console.error = (...args: unknown[]) => void lines.push(args.map(String).join(" "));
  try {
    await fn();
  } finally {
    console.error = original;
  }
  return lines.join("\n");
}

const readLog = (name: string) => readFileSync(path.join(LOG_DIR, name), "utf-8");

test("logScheduleReconcile fingerprints the invite token instead of logging it", async () => {
  const printed = await captureStderr(() =>
    logScheduleReconcile({ token: TOKEN, entry_id: "entry-42", slot: "2026-09-01T09:00", error: "stage gate not ready" })
  );
  const file = readLog("schedule-reconcile.log");

  assert.ok(!file.includes(TOKEN), "the raw token must not reach the log file");
  assert.ok(!printed.includes(TOKEN), "nor the console line the platform scrapes");

  const record = JSON.parse(file.trim().split("\n").pop()!) as Record<string, unknown>;
  assert.equal(record.token, undefined, "no `token` key survives, not even a renamed one");
  assert.equal(record.invite, FINGERPRINT, "a stable handle correlates repeat lines about one invite");
  // The operator's actionable fields are untouched — the fingerprint replaces the
  // credential, it does not cost the log its meaning.
  assert.equal(record.entry_id, "entry-42");
  assert.equal(record.slot, "2026-09-01T09:00");
  assert.equal(record.error, "stage gate not ready");
  assert.ok(printed.includes(FINGERPRINT) && printed.includes("entry-42"));
});

test("logScheduleNoSlots fingerprints the invite token too", async () => {
  const printed = await captureStderr(() => logScheduleNoSlots({ token: TOKEN, entry_id: null }));
  const file = readLog("schedule-no-slots.log");

  assert.ok(!file.includes(TOKEN), "the raw token must not reach the log file");
  assert.ok(!printed.includes(TOKEN), "nor the console line");

  const record = JSON.parse(file.trim().split("\n").pop()!) as Record<string, unknown>;
  assert.equal(record.token, undefined);
  assert.equal(record.invite, FINGERPRINT, "the SAME invite fingerprints identically across both logs");
  assert.equal(record.entry_id, null, "an unlinked invite still records its (absent) entry");
});
