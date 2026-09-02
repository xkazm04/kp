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
// Args: none → the full suite (the two default globs). Any argv → run exactly
// those files/patterns instead: `npm run test:unit -- app/_lib/offline.test.ts`.
import { spawn } from "node:child_process";

for (const key of ["NODE_TEST_CONTEXT", "DATABASE_URL", "KP_DB_BACKEND", "KP_OFFLINE"]) {
  delete process.env[key];
}

// edge/** is the Cloudflare Worker: its tests run on node:test with D1/fetch doubles
// and no wrangler, so the same runner gates them (they were green-but-ungated once).
const DEFAULT_PATTERNS = ["app/**/*.test.ts", "packages/**/*.test.ts", "edge/**/*.test.ts"];
const patterns = process.argv.length > 2 ? process.argv.slice(2) : DEFAULT_PATTERNS;

const child = spawn(
  process.execPath,
  [
    "--import",
    "./scripts/test-alias-loader.mjs",
    "--experimental-transform-types",
    "--disable-warning=ExperimentalWarning",
    "--test-isolation=process",
    "--test",
    ...patterns,
  ],
  { stdio: "inherit" }
);

child.on("error", (err) => {
  console.error("test:unit launcher could not spawn the runner:", err);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  // A signal death is a failure, not a pass — never let it map to 0.
  process.exitCode = code ?? (signal ? 1 : 0);
});
