#!/usr/bin/env node
// dev-empty — run the app as a BRAND-NEW, completely empty tenant to verify the
// first-run/onboarding experience. Companion to `npm run dev` (seeded ČS demo).
//
// What it does:
//   1. reaps any STALE empty-dev instance (see below) so its open handle on the
//      throwaway DB can't block the wipe;
//   2. deletes the throwaway DB (data/kp-empty.sqlite + WAL/SHM sidecars) so every
//      launch starts from scratch — the real data/kp.sqlite is never touched;
//   3. relaunches `next dev` through dev-guard with KP_EMPTY=1 (skips all fixture
//      content seeding — see app/_lib/db/seed-gate.ts) and KP_DB_PATH pointed at
//      the throwaway file, on port 3002 with its own .next-empty dist dir so it
//      can run beside the seeded dev server.
//
// WHY THE REAPING (the EPERM this fixes): when a previous dev-empty is killed
// HARD (terminal force-closed, task runner kill, taskkill without /T), Windows
// does not cascade the kill — dev-guard and the Next/Turbopack workers under it
// survive as orphans, keep kp-empty.sqlite open, and the next launch dies at
// rmSync with EPERM. This instance OWNS everything matching its signature
// (--port 3002 / .next-empty), so killing those strays is always safe. Belt and
// suspenders: DEV_GUARD_WATCH_PARENT=1 makes dev-guard reap its own tree the
// moment this wrapper disappears, so orphans shouldn't accumulate to begin with.
//
// Usage:  npm run dev:empty
// Keep the DB between restarts (to test "second visit" flows):  npm run dev:empty -- --keep

import { rmSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dbPath = path.join(root, "data", "kp-empty.sqlite");
const isWin = process.platform === "win32";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Kill any leftover process tree from a PREVIOUS dev-empty run. Matched by the
// instance's own signature (the 3002 port / the .next-empty dist dir), never by
// bare process name — the seeded dev server, other node apps, and parallel CLI
// sessions are untouched.
function reapStaleInstances() {
  const killed = [];
  if (isWin) {
    const query = spawnSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        // NOTE the loose `dev --port 3002` (not `next dev --port 3002`): the Next
        // bin process's command line quotes the path (`…\\bin\\next" dev --port
        // 3002`), so requiring the word "next" right before "dev" misses the one
        // process that actually holds the port + DB. Port 3002 is this
        // instance's convention, so the loose form is still unambiguous.
        "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | " +
          "Where-Object { $_.CommandLine -match 'dev --port 3002|\\.next-empty' } | " +
          "Select-Object -ExpandProperty ProcessId",
      ],
      { encoding: "utf8", timeout: 15_000 }
    );
    for (const line of String(query.stdout || "").split(/\r?\n/)) {
      const pid = Number(line.trim());
      if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) continue;
      // /T reaps each stray's own subtree too; ignore failures (already gone).
      spawnSync("taskkill", ["/pid", String(pid), "/t", "/f"], { stdio: "ignore" });
      killed.push(pid);
    }
  } else {
    // POSIX never locks the unlink, but clean up anyway so two instances don't
    // fight over port 3002.
    spawnSync("pkill", ["-f", "next dev --port 3002"], { stdio: "ignore" });
  }
  if (killed.length > 0) {
    console.log(`[dev-empty] reaped stale empty-dev process(es): ${killed.join(", ")}`);
  }
  return killed.length;
}

// Delete the throwaway DB (+ WAL/SHM sidecars), tolerating a slow handle
// release: retry briefly, and on a persistent EPERM/EBUSY reap strays once and
// try again before giving up with actionable guidance.
async function wipeDb() {
  const remove = () => {
    for (const suffix of ["", "-wal", "-shm"]) {
      // recursive:true is what activates rmSync's built-in Windows retry loop
      // (maxRetries/retryDelay are ignored without it); harmless on a plain file.
      rmSync(dbPath + suffix, { force: true, recursive: true, maxRetries: 5, retryDelay: 150 });
    }
  };
  try {
    remove();
    return;
  } catch (err) {
    if (err?.code !== "EPERM" && err?.code !== "EBUSY") throw err;
    console.warn(`[dev-empty] ${err.code} deleting ${path.relative(root, dbPath)} — a stale instance is holding it; reaping…`);
  }
  reapStaleInstances();
  await sleep(700); // let the OS release the handles
  try {
    remove();
  } catch (err) {
    if (err?.code === "EPERM" || err?.code === "EBUSY") {
      console.error(
        `[dev-empty] still cannot delete ${path.relative(root, dbPath)} (${err.code}).\n` +
          `  Something outside this instance holds it open (a DB browser? an editor plugin?).\n` +
          `  Close it and retry — or run \`npm run dev:empty -- --keep\` to reuse the existing DB as-is.`
      );
      process.exit(1);
    }
    throw err;
  }
}

const keep = process.argv.includes("--keep");
reapStaleInstances();
if (!keep) {
  await wipeDb();
  console.log(`[dev-empty] fresh start — removed ${path.relative(root, dbPath)}*`);
} else {
  console.log(`[dev-empty] --keep — reusing ${path.relative(root, dbPath)}`);
}

const child = spawn(
  process.execPath,
  [path.join(root, "scripts", "dev-guard.mjs"), "next", "dev", "--port", "3002"],
  {
    cwd: root,
    stdio: "inherit",
    env: {
      ...process.env,
      KP_EMPTY: "1",
      KP_DB_PATH: dbPath,
      // If THIS wrapper is killed hard (no signal delivered), dev-guard notices
      // its parent vanished and reaps the dev tree itself — see dev-guard.mjs.
      DEV_GUARD_WATCH_PARENT: "1",
    },
  }
);
child.on("exit", (code, signal) => process.exit(signal ? 1 : (code ?? 0)));
