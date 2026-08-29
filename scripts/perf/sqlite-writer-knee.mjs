#!/usr/bin/env node
// Where does a third concurrent writer actually degrade?
//
// docs/architecture/postgres-backend.md §2 states KP's scale ceiling — "1–2
// concurrent writers/team; writers serialize; busy_timeout=5000 waits briefly" —
// and this probe is the METHOD behind that figure (registry:
// scale-investment-timing/ceiling-as-deadline-not-trigger: a ceiling needs
// figure + axis + mechanism AND a way to re-measure it). It is a runnable
// measurement, deliberately NOT a CI gate: run it when the pragmas, the write
// shape, or the ceiling claim changes, and update the doc's measured line.
//
// What it does: creates a throwaway SQLite file, opens every connection with the
// repo's REAL canonical pragmas (the openStore() trio, app/_lib/db-path.ts —
// journal_mode=WAL, synchronous=NORMAL, busy_timeout=5000), spawns N=1..5
// concurrent writer workers (worker_threads, one connection each — the same
// shape as the app's scheduler-vs-route sibling connections on one file), and
// has each commit W small single-row transactions (the app's dominant write
// shape). Reported per N: throughput, p50/p95/max commit latency, and the count
// of SQLITE_BUSY throws (a throw means a writer waited out the FULL 5s
// busy_timeout — the user-visible failure mode).
//
// Usage: node scripts/perf/sqlite-writer-knee.mjs [--writes 400] [--max-writers 5]
//
// Spec: docs/specs/2026-08-30-sqlite-writer-knee.md

import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

const SELF = fileURLToPath(import.meta.url);

/** The canonical open — MUST mirror openStore() (app/_lib/db-path.ts). The probe
 *  measures those pragmas, not ideal ones; change them there, re-run here. */
function openLikeTheApp(file) {
  const d = new Database(file);
  d.pragma("journal_mode = WAL");
  d.pragma("synchronous = NORMAL");
  d.pragma("busy_timeout = 5000");
  return d;
}

// ---------------------------------------------------------------- worker ----
if (!isMainThread) {
  const { file, writes, writerId } = workerData;
  const db = openLikeTheApp(file);
  const insert = db.prepare(
    "INSERT INTO probe_events (writer, seq, payload, created_at) VALUES (?, ?, ?, ?)"
  );
  // One explicit transaction per row: the app's dominant write shape (a route
  // handler or scheduler tick committing one small change), which is exactly
  // where writer serialization is felt.
  const one = db.transaction((seq) => {
    insert.run(writerId, seq, "x".repeat(128), new Date().toISOString());
  });
  const latencies = new Float64Array(writes);
  let busy = 0;
  for (let seq = 0; seq < writes; seq++) {
    const t0 = process.hrtime.bigint();
    try {
      one(seq);
    } catch (e) {
      if (String(e.code).startsWith("SQLITE_BUSY")) busy++;
      else throw e;
    }
    latencies[seq] = Number(process.hrtime.bigint() - t0) / 1e6; // ms
  }
  db.close();
  parentPort.postMessage({ latencies: Array.from(latencies), busy });
}

// ------------------------------------------------------------------ main ----
function quantile(sorted, q) {
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[idx];
}

async function runRound(file, writers, writes) {
  const results = await Promise.all(
    Array.from({ length: writers }, (_, writerId) =>
      new Promise((resolve, reject) => {
        const w = new Worker(SELF, { workerData: { file, writes, writerId } });
        w.once("message", resolve);
        w.once("error", reject);
      })
    )
  );
  const all = results.flatMap((r) => r.latencies).sort((a, b) => a - b);
  const busy = results.reduce((n, r) => n + r.busy, 0);
  const totalMs = all.reduce((a, b) => a + b, 0);
  return {
    writers,
    commits: all.length,
    busy,
    p50: quantile(all, 0.5),
    p95: quantile(all, 0.95),
    max: all[all.length - 1],
    // Wall-clock throughput approximation: commits over the mean writer busy time.
    perSec: Math.round((all.length / (totalMs / writers)) * 1000),
  };
}

async function main() {
  const args = process.argv.slice(2);
  const flag = (name, dflt) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? Number(args[i + 1]) : dflt;
  };
  const writes = flag("writes", 400);
  const maxWriters = flag("max-writers", 5);

  const dir = mkdtempSync(path.join(tmpdir(), "kp-writer-knee-"));
  const file = path.join(dir, "probe.sqlite");
  const db = openLikeTheApp(file);
  db.exec(`CREATE TABLE probe_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    writer INTEGER NOT NULL,
    seq INTEGER NOT NULL,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL
  );`);
  db.close();

  console.log(`sqlite writer-knee probe — WAL, synchronous=NORMAL, busy_timeout=5000`);
  console.log(`${writes} single-row transactions per writer; throwaway DB: ${file}\n`);
  console.log("writers | commits | busy(>5s) | p50 ms | p95 ms | max ms | ~commits/s");
  console.log("--------|---------|-----------|--------|--------|--------|-----------");
  const rows = [];
  for (let n = 1; n <= maxWriters; n++) {
    // Warm-free sequential rounds: each N gets a fresh contention picture on the
    // same file (WAL grows across rounds — like a live DB, not a clean-room).
    const r = await runRound(file, n, writes);
    rows.push(r);
    console.log(
      `${String(r.writers).padStart(7)} | ${String(r.commits).padStart(7)} | ` +
        `${String(r.busy).padStart(9)} | ${r.p50.toFixed(2).padStart(6)} | ` +
        `${r.p95.toFixed(2).padStart(6)} | ${r.max.toFixed(2).padStart(6)} | ${String(r.perSec).padStart(10)}`
    );
  }

  // Name the knee: first N whose p95 exceeds 5x the single-writer p95 (material
  // user-visible degradation), and the first N that threw BUSY at all.
  const base = rows[0].p95;
  const knee = rows.find((r) => r.p95 > base * 5 && r.writers > 1);
  const firstBusy = rows.find((r) => r.busy > 0);
  console.log("");
  console.log(
    knee
      ? `knee: p95 degrades >5x single-writer at N=${knee.writers} (${knee.p95.toFixed(2)}ms vs ${base.toFixed(2)}ms)`
      : `knee: not reached by N=${maxWriters} (p95 stayed within 5x of single-writer ${base.toFixed(2)}ms)`
  );
  console.log(
    firstBusy
      ? `busy onset: first SQLITE_BUSY (5s wait exhausted) at N=${firstBusy.writers}`
      : `busy onset: no SQLITE_BUSY up to N=${maxWriters} — every writer got in under busy_timeout`
  );
  rmSync(dir, { recursive: true, force: true });
}

if (isMainThread) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
