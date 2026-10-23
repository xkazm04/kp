// The machine-wide slot (ADR 0029), shared by every launcher whose wall-clock load can starve
// the timing-bound unit tests: the unit-test runner, `npm run typecheck` and `npm run build`.
//
// A lock directory in os.tmpdir() (mkdir is atomic) holds an owner.json with the launcher's pid.
// A second launcher waits and says whose run it is waiting for. The holder's children inherit
// KP_TEST_SLOT_HELD, so a launcher started BY the holder does not wait on its own parent. A slot
// whose owner is dead, or older than SLOT_STALE_MS, is taken over. KP_TEST_SLOT=0 opts out;
// KP_TEST_SLOT_DIR moves the lock. When the slot cannot be taken the launcher warns and runs.
//
// As a command: `node scripts/test-slot.mjs <label> <command...>` holds the slot around the
// command and exits with its code (package.json uses it for typecheck and build).
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// A run that has held the slot this long is not running any more: even three contending
// suites finished in ~14 minutes. Past it, a lock is a leftover, whoever's pid it names.
export const SLOT_STALE_MS = 45 * 60 * 1000;
const SLOT_POLL_MS = Number(process.env.KP_TEST_SLOT_POLL_MS) || 1000;

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** The slot's owner record, or null when it is missing or half-written. */
export function readSlotOwner(dir) {
  try {
    const owner = JSON.parse(fs.readFileSync(path.join(dir, "owner.json"), "utf8"));
    return Number.isInteger(owner.pid) && Number.isFinite(owner.at) ? owner : null;
  } catch {
    return null; // a holder between mkdir and its write — judged by the dir's age below
  }
}

export function pidAlive(pid) {
  try {
    process.kill(pid, 0); // signal 0 = existence probe; sends nothing
    return true;
  } catch (e) {
    return e.code === "EPERM"; // exists, owned by someone else
  }
}

/** Take the machine-wide slot, waiting while a live run holds it. Returns the
 *  release function, or null when this run must not take one.
 *  `label` prefixes the messages ("test:unit", "typecheck", "build"). */
export function acquireSuiteSlot({ label = "test:unit", repoRoot = process.cwd() } = {}) {
  if (process.env.KP_TEST_SLOT === "0" || process.env.KP_TEST_SLOT_HELD) return null;
  const dir = process.env.KP_TEST_SLOT_DIR || path.join(os.tmpdir(), "kp-test-unit-slot");
  let announced = false;
  for (;;) {
    try {
      fs.mkdirSync(dir);
      fs.writeFileSync(path.join(dir, "owner.json"), JSON.stringify({ pid: process.pid, cwd: repoRoot, at: Date.now() }));
      break;
    } catch (e) {
      if (e.code !== "EEXIST") {
        console.error(`${label} — could not take the suite slot at ${dir} (${e.code}); running without it.`);
        return null;
      }
    }
    const owner = readSlotOwner(dir);
    let since = owner?.at;
    if (since === undefined) {
      try {
        since = fs.statSync(dir).mtimeMs;
      } catch {
        continue; // released between our mkdir and this stat — take it on the next pass
      }
    }
    const stale = Date.now() - since > SLOT_STALE_MS || (owner !== null && !pidAlive(owner.pid));
    if (stale) {
      // Remove only the lock we judged: a waiter that got there first has written a new owner.
      if (JSON.stringify(readSlotOwner(dir)) === JSON.stringify(owner)) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
      continue;
    }
    if (!announced) {
      announced = true;
      const who = owner ? `pid ${owner.pid} in ${owner.cwd}` : "a run that is starting";
      console.log(`${label} — another suite is running on this machine (${who}); waiting for it, so the two do not starve each other's timing-bound tests…`);
    }
    sleepSync(SLOT_POLL_MS);
  }
  process.env.KP_TEST_SLOT_HELD = String(process.pid);
  return () => {
    if (readSlotOwner(dir)?.pid === process.pid) fs.rmSync(dir, { recursive: true, force: true });
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [label, ...command] = process.argv.slice(2);
  if (!label || command.length === 0) {
    console.error("usage: node scripts/test-slot.mjs <label> <command...>");
    process.exit(2);
  }
  const release = acquireSuiteSlot({ label });
  let code = 1;
  try {
    // shell: npm is npm.cmd on Windows; the command is ours (package.json), never user input.
    const res = spawnSync(command.join(" "), { stdio: "inherit", shell: true });
    code = res.status ?? 1;
  } finally {
    release?.();
  }
  process.exit(code);
}
