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
// NON-VACUITY is a FIXTURE here, not a claim in this comment: the bottom of the file
// factors the assertions into one checker and runs it against a deliberately unsafe
// logger (entry appended verbatim, token interpolated into the console line), asserting
// the checker REJECTS it. A matcher that quietly stops matching fails there rather than
// passing everywhere.
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

// ── Non-vacuity, as a fixture rather than a claim ──────────────────────────────
//
// The header above SAYS "with the fingerprinting removed, both assertions fail". Prose
// is not a check: nothing re-reads it when logger.ts changes, and a matcher that has
// quietly stopped matching (a renamed field, a token shape the regex no longer sees)
// passes the two tests above in exactly the way it would pass against the bug.
//
// So the assertions are factored into one checker, and the checker is run against a
// deliberately UNSAFE logger built here — the pre-fix shape: the entry appended
// verbatim, and the token interpolated into the console line. That reproduction MUST be
// rejected. Anything that weakens the checker (a regex that stops matching, an assertion
// that becomes trivially true) makes this test go green-on-a-bug and fail here instead.
import { appendFileSync } from "node:fs";

/** Everything the two tests above demand of a schedule log line. Throws on a violation,
 *  exactly as the tests do — the point is that one body of assertions is used twice. */
function assertTokenIsFingerprinted(fileLine: string, printed: string, token: string): void {
  assert.ok(!fileLine.includes(token), "the raw token must not reach the log file");
  assert.ok(!printed.includes(token), "nor the console line the platform scrapes");
  const record = JSON.parse(fileLine) as Record<string, unknown>;
  assert.equal(record.token, undefined, "no `token` key survives, not even a renamed one");
  assert.equal(record.invite, createHash("sha256").update(token).digest("hex").slice(0, 12), "a stable handle correlates repeat lines");
}

test("the safe loggers satisfy the checker the unsafe fixture below must fail", async () => {
  const printed = await captureStderr(() => logScheduleNoSlots({ token: TOKEN, entry_id: "entry-7" }));
  const line = readLog("schedule-no-slots.log").trim().split("\n").pop()!;
  assertTokenIsFingerprinted(line, printed, TOKEN);
});

test("a logger that writes the token verbatim is REJECTED by that same checker", async () => {
  // The shape logger.ts had before inviteRef: spread the entry (token and all) into the
  // record, and put the token in the console line for "easier debugging".
  const unsafeLog = path.join(LOG_DIR, "unsafe-fixture.log");
  const printed = await captureStderr(async () => {
    const entry = { token: TOKEN, entry_id: "entry-7" };
    console.error(`[schedule:no-slots] candidate hit a fully-booked horizon — token=${entry.token}`);
    appendFileSync(unsafeLog, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n", "utf-8");
  });
  const line = readFileSync(unsafeLog, "utf-8").trim().split("\n").pop()!;

  assert.throws(
    () => assertTokenIsFingerprinted(line, printed, TOKEN),
    /raw token must not reach the log file/,
    "the checker must reject a raw-token line — if it does not, the two tests above prove nothing"
  );

  // And each half is caught independently: a record that fingerprints the file line but
  // still prints the credential to stdout is just as exploitable.
  const halfSafe = JSON.stringify({ invite: FINGERPRINT, entry_id: "entry-7" });
  assert.throws(
    () => assertTokenIsFingerprinted(halfSafe, `[schedule:no-slots] token=${TOKEN}`, TOKEN),
    /console line/,
    "a clean file with a leaking console line must still be rejected"
  );
  // …as is a record that merely renames the field it leaks.
  assert.throws(
    () => assertTokenIsFingerprinted(JSON.stringify({ invite: FINGERPRINT, capability: TOKEN }), "clean", TOKEN),
    /raw token must not reach the log file/,
    "renaming `token` to something else is not fingerprinting"
  );
});
