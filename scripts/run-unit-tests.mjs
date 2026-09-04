// Launcher for `npm run test:unit`. Exists because the runner's environment must
// be scrubbed BEFORE the `node --test` process boots — two ambient variables can
// otherwise silently corrupt the gate, and a `--import` preload runs too late to
// stop the first one (measured 2026-08-27, node v24.14.0):
//
// 1. NODE_TEST_CONTEXT — node's internal "I am a test-runner child" marker.
//    Inherited from ANY ancestor `node --test` process (the bench driver
//    `test:bench-driver`, a test that shells out to the gate, …), it flips a
//    fresh `node --test` into child-reporting mode: failures still print, but
//    the process ALWAYS exits 0 because a parent runner is presumed to
//    aggregate — and none exists. That is a permanently false-green gate.
//    Node decides this during bootstrap, before --import preloads execute, so
//    deleting it here — in the parent that spawns the runner — is the only
//    reliable door. (The runner then re-sets it correctly for its own
//    isolation children, with a live parent aggregating their results.)
//
// 2. DATABASE_URL / KP_DB_BACKEND / KP_OFFLINE — backend selection + egress
//    gating read from the shell. On 2026-08-26 an ambient postgres
//    DATABASE_URL made resolveDbBackend() throw (E-SH-3) in the five test
//    files that had not imported unit-db.ts, turning the suite red on main
//    while CI (clean env) stayed green. Store/egress behavior must come from
//    the test itself, never from whichever shell hosts the run. unit-db.ts
//    still owns the longer per-file determinism list (Polar, comms, TTLs, …)
//    and the isolated KP_DB_PATH; scrubbing here just makes the suite-wide
//    floor independent of per-file discipline. A test that needs one of these
//    sets it explicitly (see app/_lib/offline.test.ts).
//
// The exit-code contract itself is pinned by app/_lib/testing/gate-exit-code.test.ts,
// which drives this launcher from a deliberately polluted environment.
//
// 3. A per-test TIMEOUT. Node's runner waits FOREVER by default, so one test that
//    never settles — an unresolved promise, a socket nobody closes, a prompt on
//    stdin — hangs the gate until a CI job timeout or a human kills it, and the
//    output at that point names no test. `--test-timeout` turns that into a normal
//    red: the hung test fails, the rest of the suite still reports, and the exit
//    code is non-zero. KP_TEST_TIMEOUT_MS overrides the default (the exit-code
//    fixture drives a deliberately hanging file with a short one).
//
// ─────────────────────────────────────────────────────────────────────────────
// AND ONE MORE THING THE EXIT CODE COULD NOT SAY: WAS IT A FLAKE?
//
// 799 test files answered with one bit. When the suite went red, nothing in the
// run distinguished "this test is broken" from "this test failed once and passes
// when you press the button again" — so the cheapest available move for an agent
// that did not cause the failure was to press the button, and that is a lesson
// learned once and applied to every red build afterwards, including the real
// ones.
//
// So a failing run now answers the question instead of leaving it open:
//
//   1. A second, machine-readable reporter rides alongside the human one
//      (scripts/test/flake-reporter.mjs) and records WHICH FILES failed. The
//      console output is unchanged — the human reporter is still node's own
//      default, chosen the same way node chooses it.
//   2. Exactly those files are re-run, once, in a fresh runner with the same
//      flags and the same scrubbed environment.
//   3. Each is labelled BROKEN (failed twice), FLAKE (failed, then passed) or
//      QUARANTINE (declared in test-quarantine.json), and the block is printed
//      and appended to the CI step summary when there is one. That is where a
//      flake gets recorded, which is the thing that was missing.
//
// A FLAKE STILL FAILS THE BUILD. Retrying until green would convert a flake from
// a visible cost into an invisible one and let the suite's sensitivity fall with
// nothing reporting it. The two real moves are to fix the test or to quarantine
// it deliberately — scripts/test/flake-policy.mjs holds the register to a
// ceiling, a reason and an expiry date.
//
// KP_FLAKE_RERUN=0 turns step 2 off (the run then reports `FAILED … not re-run`
// rather than guessing) for a caller that only wants the first verdict.
//
// Args: none → the full suite (the two default globs). Any argv → run exactly
// those files/patterns instead: `npm run test:unit -- app/_lib/offline.test.ts`.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  checkRegister,
  classifyRun,
  loadRegister,
  registerBlocks,
  renderRegister,
  renderRun,
} from "./test/flake-policy.mjs";

for (const key of ["NODE_TEST_CONTEXT", "DATABASE_URL", "KP_DB_BACKEND", "KP_OFFLINE"]) {
  delete process.env[key];
}

const REPO_ROOT = process.cwd();
// edge/** is the Cloudflare Worker: its tests run on node:test with D1/fetch doubles
// and no wrangler, so the same runner gates them (they were green-but-ungated once).
// i18n/** is the locale universe + the ONE server-side resolution path (cookie >
// Accept-Language > en). It sits outside app/, which is why proxy.ts's header says
// public-routes.ts "sits outside the app/**/*.test.ts runner glob" — and why
// i18n/locales.test.ts would have been a test nothing ran.
const DEFAULT_PATTERNS = [
  "app/**/*.test.ts",
  "packages/**/*.test.ts",
  "edge/**/*.test.ts",
  "i18n/**/*.test.ts",
];
const patterns = process.argv.length > 2 ? process.argv.slice(2) : DEFAULT_PATTERNS;

// A tree this broken is not a flake question. Re-running fifty files to learn
// that fifty files are broken doubles the slowest gate in CI to say nothing.
const MAX_RERUN_FILES = 20;

// Per-test ceiling. 120 s is far above the slowest real test here (the exit-code
// fixtures, which each spawn a whole runner, land around 5 s) and far below any CI
// job budget, so it only ever fires on a genuine hang.
const DEFAULT_TEST_TIMEOUT_MS = 120_000;
const overriddenTimeout = Number(process.env.KP_TEST_TIMEOUT_MS);
const testTimeoutMs =
  Number.isFinite(overriddenTimeout) && overriddenTimeout > 0
    ? overriddenTimeout
    : DEFAULT_TEST_TIMEOUT_MS;


/**
 * The register is checked BEFORE the suite runs, so an entry that names a
 * deleted file or a quarantine that came due is a red build even on a run where
 * nothing fails — which is the only kind of run those two rot on.
 */
const register = loadRegister(REPO_ROOT);
const registerFindings = checkRegister(register, (p) => fs.existsSync(path.join(REPO_ROOT, p)));
if (registerBlocks(registerFindings)) {
  console.error(`test:unit — the quarantine register is not in a state the gate can read:\n${renderRegister(registerFindings)}`);
  process.exit(1);
}
const registerNotes = renderRegister(registerFindings);
if (registerNotes) console.log(registerNotes);

// Node's own default: `spec` on a TTY, `tap` otherwise. Named explicitly because
// passing ANY --test-reporter means passing all of them, and the console output
// of this gate must not change because a second, silent reporter was added.
const humanReporter = process.stdout.isTTY ? "spec" : "tap";
// A cwd-relative specifier, the form node's own documentation uses for a custom
// reporter — and the same assumption `--import ./scripts/test-alias-loader.mjs`
// below already makes, which npm satisfies by running scripts from the root.
const FLAKE_REPORTER = "./scripts/test/flake-reporter.mjs";

/** The failures the machine reporter recorded. `[]` for a run it could not attribute. */
function readFailures(file) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return []; // no failures were attributable — a crash, or a green run
  }
  const out = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    // Per line, not per file: a runner killed mid-write leaves one truncated
    // record, and losing every failure because the last one was cut short is
    // exactly the misreading the whole classification exists to avoid.
    try {
      out.push(JSON.parse(line));
    } catch {
      /* a partial record proves nothing about the ones that parsed */
    }
  }
  return out;
}

function runSuite(files, destination) {
  return spawnSync(
    process.execPath,
    [
      "--import",
      "./scripts/test-alias-loader.mjs",
      "--experimental-transform-types",
      "--disable-warning=ExperimentalWarning",
      "--test-isolation=process",
      `--test-timeout=${testTimeoutMs}`,
      "--test-reporter",
      humanReporter,
      "--test-reporter-destination",
      "stdout",
      "--test-reporter",
      FLAKE_REPORTER,
      "--test-reporter-destination",
      destination,
      "--test",
      ...files,
    ],
    { stdio: "inherit" }
  );
}

/** The whole run, as a code. Kept a function so the temp dir is cleaned by the
 *  caller — `process.exit()` abandons the stack, so a `finally` around it never
 *  runs and the directory would leak once per red build. */
function run(workdir) {
  const firstDest = path.join(workdir, "first.ndjson");
  const first = runSuite(patterns, firstDest);
  if (first.error) {
    console.error("test:unit launcher could not spawn the runner:", first.error);
    return 1;
  }
  // A signal death is a failure, not a pass — never let it map to 0.
  const firstCode = first.status ?? (first.signal ? 1 : 0);
  if (firstCode === 0) return 0;

  const failures = readFailures(firstDest);
  const files = [...new Set(failures.map((f) => f.file))];
  const rerun = process.env.KP_FLAKE_RERUN !== "0" && files.length > 0 && files.length <= MAX_RERUN_FILES;

  let second = [];
  if (rerun) {
    console.log(`\ntest:unit — re-running ${files.length} failing file(s) once, to tell a flake from a break…`);
    const secondDest = path.join(workdir, "second.ndjson");
    const res = runSuite(files, secondDest);
    // A re-run that could not start proves nothing. Treat every file as still
    // failing rather than reporting a fleet of flakes the runner never observed.
    second = res.error ? failures : readFailures(secondDest);
  }

  const outcome = classifyRun({ first: failures, second, register, rerun });
  const report = renderRun(outcome);
  if (report) {
    console.log(report);
    // Where CI actually keeps a record. A flake written only to a temp file on a
    // runner that is about to be destroyed has not been recorded anywhere.
    const summary = process.env.GITHUB_STEP_SUMMARY;
    if (summary) {
      try {
        fs.appendFileSync(summary, `\n\`\`\`\n${report}\n\`\`\`\n`);
      } catch {
        /* the record is already on stdout; a summary that cannot be written is not a gate failure */
      }
    }
  }

  // Every failure quarantined ⇒ green, and it says so above. Anything else keeps
  // the original exit code: this classifies failures, it never absolves them.
  return failures.length && !outcome.blocking ? 0 : firstCode;
}

const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "kp-flake-"));
let code = 1;
try {
  code = run(workdir);
} finally {
  fs.rmSync(workdir, { recursive: true, force: true });
}
process.exit(code);
