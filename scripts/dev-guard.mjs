#!/usr/bin/env node
// dev-guard — wrap a long-running dev command so its ENTIRE process tree is
// reaped when this guard exits, and (optionally) trip a circuit breaker if node
// processes storm.
//
// WHY THIS EXISTS
// On 2026-06-18 a `npm run dev:inspect` run (Next.js + Turbopack with a custom
// `*.tsx` loader) leaked ~2,800 orphaned node worker processes holding 15.8 GB.
// Turbopack runs JS loaders in node subprocess workers; on Windows those workers
// are NOT killed when the parent dev server stops (Windows doesn't cascade a
// kill down the tree), so closing the terminal / stopping `next dev` stranded
// them. The root cause was fixed by moving the loader to webpack, but this guard
// is the defense-in-depth that makes ANY future dev-server worker leak
// impossible: whatever spawns under the dev command dies with it.
//
// Usage:  node scripts/dev-guard.mjs <command> [args...]
//   e.g.  node scripts/dev-guard.mjs next dev
//         cross-env DEV_INSPECT=1 DEV_GUARD_MAX_NODE=150 node scripts/dev-guard.mjs next dev --webpack
//
// Env:
//   DEV_GUARD_MAX_NODE   if set, enable the storm circuit breaker: trip when the
//                        number of node processes grows by more than this many
//                        over the baseline measured at launch (default: off).
//   DEV_GUARD_POLL_MS    breaker poll interval in ms (default 8000).

import { spawn, spawnSync } from "node:child_process";

const argv = process.argv.slice(2);
if (argv.length === 0) {
  console.error("dev-guard: no command given\n  usage: node scripts/dev-guard.mjs <command> [args...]");
  process.exit(2);
}

const isWin = process.platform === "win32";
const MAX_NODE_DELTA = process.env.DEV_GUARD_MAX_NODE ? Number(process.env.DEV_GUARD_MAX_NODE) : null;
const POLL_MS = Number(process.env.DEV_GUARD_POLL_MS) || 8000;

// shell:true lets Windows resolve the `.cmd` shims (next, cross-env) that npm
// puts on PATH for scripts, without us hardcoding node_modules/.bin paths.
const child = spawn(argv[0], argv.slice(1), { stdio: "inherit", shell: true });

let reaped = false;
function reapTree() {
  if (reaped || child.pid == null) return;
  reaped = true;
  if (isWin) {
    // /T = whole tree (the shell -> next -> every loader/render/compile worker),
    // /F = force. This is the cascade Windows won't do on its own; it's what
    // stops the dev server's children from outliving this guard.
    spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" });
  } else {
    // POSIX: signal the child's process group (negative pid).
    try { process.kill(-child.pid, "SIGTERM"); } catch { /* group already gone */ }
    try { child.kill("SIGTERM"); } catch { /* already exited */ }
  }
}

// Reap on every exit path so the dev tree can never outlive the guard: Ctrl-C,
// terminal close, `kill`, or this process exiting normally.
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"]) {
  process.on(sig, () => { reapTree(); process.exit(130); });
}
process.on("exit", reapTree);

child.on("exit", (code, signal) => {
  // The dev server itself stopped (clean exit or crash). Reap anything it left
  // behind, then mirror its status so `npm run dev` reports correctly.
  reapTree();
  process.exit(signal ? 1 : (code ?? 0));
});
child.on("error", (err) => {
  console.error(`dev-guard: failed to launch '${argv.join(" ")}': ${err.message}`);
  process.exit(1);
});

// ---- optional storm circuit breaker -------------------------------------
// Counts node processes via Get-Process / pgrep — deliberately NOT `tasklist`,
// which crawls (or hangs) once the process table is already huge, i.e. exactly
// when you need the count. We compare against the launch baseline so unrelated
// node processes from other projects don't cause false trips.
function nodeCount() {
  try {
    const r = isWin
      ? spawnSync("powershell", ["-NoProfile", "-Command", "(Get-Process node -ErrorAction SilentlyContinue).Count"], { encoding: "utf8", timeout: 5000 })
      : spawnSync("pgrep", ["-c", "node"], { encoding: "utf8", timeout: 5000 });
    return parseInt(String(r.stdout || "").trim(), 10) || 0;
  } catch {
    return 0;
  }
}

if (MAX_NODE_DELTA != null && Number.isFinite(MAX_NODE_DELTA)) {
  const baseline = nodeCount();
  const timer = setInterval(() => {
    const n = nodeCount();
    if (n - baseline > MAX_NODE_DELTA) {
      console.error(
        `\n[dev-guard] node processes spiked to ${n} (baseline ${baseline}, +${n - baseline} > ${MAX_NODE_DELTA}). ` +
        `Worker storm detected — reaping the dev tree and aborting.`
      );
      clearInterval(timer);
      reapTree();
      process.exit(1);
    }
  }, POLL_MS);
  timer.unref?.();
}
