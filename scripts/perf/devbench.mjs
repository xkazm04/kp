#!/usr/bin/env node
// devbench — measure what `next dev` actually costs, so dev-performance claims in
// docs/architecture/app-structure.md stay evidence-backed instead of folklore.
//
//   node scripts/perf/devbench.mjs <label> [--cold] [--burst] [--record]
//
//     --cold   wipe .next/dev/cache/turbopack first (worst case: a mass source
//              change or a deleted .next). Without it you measure the realistic
//              day-to-day restart, which the persistent cache makes ~3x cheaper.
//     --burst  also fire the 10 API routes the workspace really calls on load,
//              concurrently, so the page compile contends the way it does in a
//              real browser session.
//
// Always measures, in order: boot -> first `/` -> every `_next` asset the HTML
// references (client chunks are compiled on demand, so this is a real cost the
// HTML timing alone hides) -> a second warm `/` to prove the compile was the cost.
// Appends one JSON row per run to .next/devbench.jsonl AND compares the run to
// the committed baseline in scripts/perf/devbench-baseline.json, exiting non-zero
// when a metric is more than DEFAULT_TOLERANCE (35%) worse than it.
//
// WHY A COMMITTED BASELINE. This tool measured faithfully and remembered nothing:
// the numbers went into a gitignored .jsonl under .next/, which is wiped by every
// `--cold` run and does not exist on anybody else's machine. So a dev-server
// regression was invisible between sessions unless a human happened to scroll back
// through their own terminal — and the only durable record was a prose table in
// docs/architecture/app-structure.md that nothing compared anything to.
//
// The baseline is per VARIANT (warm / cold / +burst), not per label: the label is a
// free-text note about why you ran it, and comparing two labels would compare two
// different things. `--record` writes the current run into the baseline, which is a
// deliberate act with a diff to review — the ratchet only moves when someone moves
// it. 35% is a wide gate on purpose: these are wall-clock numbers off a developer's
// machine with a browser open, and a gate that cries wolf gets ignored, which is
// how you end up with no gate. It catches the doubling, not the jitter.
//
// WHY IT KILLS :3000 FIRST: Next allows one dev server per checkout (.next/dev/lock).
// The bench takes the port for the duration and frees it on exit — do not run it
// against a dev server you care about; start yours again afterwards.

import { spawn, spawnSync } from "node:child_process";
import { rmSync, existsSync, renameSync, appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// ── the baseline: pure, so the fixtures can exercise every verdict ────────────

export const BASELINE_FILE = join(dirname(fileURLToPath(import.meta.url)), "devbench-baseline.json");

/** How much worse than the baseline a metric may get before the run fails. */
export const DEFAULT_TOLERANCE = 0.35;

/** The metrics a regression can hide in. `assetKB` is deliberately NOT here: it is
 *  a size, not a duration, and it moves for legitimate reasons (a new dependency)
 *  that this tool is the wrong place to argue about. */
export const COMPARED_METRICS = ["bootMs", "firstMs", "warmMs", "totalMs"];

/** Which baseline entry a run is comparable to. The LABEL is a free-text note about
 *  why the run happened; what makes two runs comparable is the variant they
 *  measured, so that is the key. */
export function variantKey(row) {
  return `${row.cold ? "cold" : "warm"}${row.burst ? "+burst" : ""}`;
}

/** Read the committed baseline. A missing or unreadable file is not fatal — the
 *  tool still measures — but it IS reported, because a baseline that quietly
 *  vanished is indistinguishable from one that never regressed. */
export function loadBaseline(file = BASELINE_FILE) {
  if (!existsSync(file)) return { entries: {}, missing: true };
  try {
    const parsed = JSON.parse(readFileSync(file, "utf-8"));
    return { entries: parsed.entries ?? {}, missing: false };
  } catch (err) {
    return { entries: {}, missing: true, error: err.message };
  }
}

/**
 * Compare one measured row to the baseline.
 *
 * Verdicts: `unbaselined` (nothing to compare — say so and pass, or the first run
 * of a new variant fails for existing), `ok`, `regressed`. Improvements are
 * reported too: a baseline that is 3x slower than reality is not a gate, it is a
 * rubber stamp, and nobody tightens what nobody prints.
 */
export function compareToBaseline(row, entries, tolerance = DEFAULT_TOLERANCE) {
  const key = variantKey(row);
  const base = entries[key];
  if (!base) return { key, verdict: "unbaselined", regressions: [], improvements: [] };
  const regressions = [];
  const improvements = [];
  for (const metric of COMPARED_METRICS) {
    const before = base[metric];
    const after = row[metric];
    if (typeof before !== "number" || typeof after !== "number" || before <= 0) continue;
    const ratio = after / before;
    if (ratio > 1 + tolerance) regressions.push({ metric, baseline: before, measured: after, ratio });
    else if (ratio < 1 - tolerance) improvements.push({ metric, baseline: before, measured: after, ratio });
  }
  return {
    key,
    verdict: regressions.length ? "regressed" : "ok",
    regressions,
    improvements,
    platformChanged: Boolean(base.platform) && base.platform !== process.platform,
  };
}

/** The baseline document `--record` writes. Returns a NEW object; the caller
 *  writes it, so a fixture can assert the shape without touching the repo. */
export function withRecorded(baseline, row, now = new Date()) {
  const key = variantKey(row);
  const entry = { recordedAt: now.toISOString(), label: row.label, platform: process.platform };
  for (const metric of [...COMPARED_METRICS, "assetCount", "assetKB", "assetMs"]) {
    if (typeof row[metric] === "number") entry[metric] = row[metric];
  }
  return {
    _doc: baseline._doc ?? BASELINE_DOC,
    tolerance: baseline.tolerance ?? DEFAULT_TOLERANCE,
    entries: { ...(baseline.entries ?? {}), [key]: entry },
  };
}

export const BASELINE_DOC =
  "Committed dev-server baseline for scripts/perf/devbench.mjs. Keyed by VARIANT " +
  "(warm/cold, +burst), not by run label. A run more than `tolerance` worse than " +
  "its entry exits non-zero. Move a number with `node scripts/perf/devbench.mjs " +
  "<label> --record`, and review the diff — that is the whole ratchet.";

const label = process.argv[2] ?? "run";
const cold = process.argv.includes("--cold");
const burst = process.argv.includes("--burst");
const record = process.argv.includes("--record");
const ROOT = process.cwd();
const BASE = "http://localhost:3000";
const TRACE = join(ROOT, ".next", "dev", "trace");

// What the workspace actually requests on load (taken from the dev log).
const BURST_URLS = [
  "/api/me/getting-started", "/api/attention", "/api/tasks", "/api/pipeline",
  "/api/pipeline/events", "/api/comms", "/api/comms/relay", "/api/jobs?limit=200",
  "/api/channels/webhooks", "/api/schedule",
];

function freePort() {
  if (process.platform !== "win32") {
    spawnSync("bash", ["-c", "lsof -ti:3000 | xargs -r kill -9"], { stdio: "ignore" });
    return;
  }
  spawnSync("powershell", ["-NoProfile", "-Command",
    "Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | " +
    "ForEach-Object { taskkill /pid $_.OwningProcess /t /f 2>$null }"], { stdio: "ignore" });
}

const get = (u) => fetch(BASE + u).then((r) => r.arrayBuffer()).catch(() => new ArrayBuffer(0));

// Everything below only runs as a script: scripts/perf/__tests__/devbench.test.mjs
// imports this module for the pure half above, and an import must not take port
// 3000, wipe a cache or spawn a dev server.
const AS_SCRIPT = process.argv[1]?.endsWith("devbench.mjs") ?? false;

if (AS_SCRIPT) freePort();
if (AS_SCRIPT && cold) rmSync(join(ROOT, ".next", "dev", "cache", "turbopack"), { recursive: true, force: true });
// Rotate the trace so `.next/dev/trace` holds only this run's spans — it is the
// authoritative record when a dev-log number looks impossible (overlapping
// handle-request spans make one compile look like several separate slow requests).
if (AS_SCRIPT && existsSync(TRACE)) { try { renameSync(TRACE, `${TRACE}.${label}.bak`); } catch { /* in use */ } }

let t0 = 0;
let readyAt = null;
let child = null;
if (AS_SCRIPT) {
  t0 = Date.now();
  child = spawn("npm", ["run", "dev"], { shell: true, cwd: ROOT, env: { ...process.env, FORCE_COLOR: "0" } });
  let seen = "";
  const onData = (b) => {
    seen += b.toString();
    if (readyAt === null && /Ready in/.test(seen)) { readyAt = Date.now(); measure(); }
  };
  child.stdout.on("data", onData);
  child.stderr.on("data", onData);
}

async function measure() {
  const bootMs = readyAt - t0;

  const a = Date.now();
  const side = burst ? BURST_URLS.map(get) : [];
  let code = -1;
  try { const r = await fetch(BASE + "/", { redirect: "manual" }); await r.arrayBuffer(); code = r.status; } catch { /* down */ }
  const firstMs = Date.now() - a;
  await Promise.all(side);
  const burstMs = Date.now() - a;

  // Client chunks compile on demand; the HTML timing alone hides them.
  const html = await fetch(BASE + "/").then((r) => r.text()).catch(() => "");
  const urls = new Set([...html.matchAll(/(?:src|href)="(\/_next\/[^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, "&")));
  const c = Date.now();
  const sizes = await Promise.all([...urls].map((u) => get(u).then((b) => b.byteLength)));
  const assetMs = Date.now() - c;

  const w = Date.now();
  await get("/");
  const warmMs = Date.now() - w;

  const row = {
    label, cold, burst, code, bootMs, firstMs, burstMs,
    assetCount: urls.size, assetKB: Math.round(sizes.reduce((s, n) => s + n, 0) / 1024), assetMs,
    warmMs, totalMs: bootMs + burstMs + assetMs,
  };
  if (code !== 200) console.error(`devbench: '${label}' returned HTTP ${code} — timings below are NOT comparable.`);
  console.log("RESULT " + JSON.stringify(row));
  appendFileSync(join(ROOT, ".next", "devbench.jsonl"), JSON.stringify(row) + "\n");

  // A run that did not serve the page measured nothing, so it must neither move
  // the baseline nor be judged against it.
  let exitCode = code === 200 ? 0 : 1;
  const { entries, missing, error } = loadBaseline();
  if (code !== 200) {
    console.error("devbench: skipping the baseline comparison — this run is not a measurement.");
  } else if (record) {
    writeFileSync(BASELINE_FILE, JSON.stringify(withRecorded({ entries }, row), null, 2) + "\n", "utf-8");
    console.log(`devbench: recorded '${variantKey(row)}' into ${BASELINE_FILE}. Review the diff before committing.`);
  } else {
    if (missing) console.error(`devbench: no readable baseline (${error ?? "file missing"}) — nothing to compare against.`);
    const verdict = compareToBaseline(row, entries);
    if (verdict.platformChanged) {
      console.error(`devbench: the baseline for '${verdict.key}' was recorded on a different platform — treat the comparison as advisory.`);
    }
    if (verdict.verdict === "unbaselined") {
      console.error(`devbench: no baseline for variant '${verdict.key}' — re-run with --record to create one.`);
    } else {
      for (const i of verdict.improvements) {
        console.log(`devbench: ${i.metric} is ${(100 * (1 - i.ratio)).toFixed(0)}% FASTER than the baseline (${i.measured}ms vs ${i.baseline}ms) — consider --record.`);
      }
      for (const r of verdict.regressions) {
        console.error(`devbench: REGRESSION ${r.metric} ${r.measured}ms vs baseline ${r.baseline}ms (+${(100 * (r.ratio - 1)).toFixed(0)}%, tolerance ${(100 * DEFAULT_TOLERANCE).toFixed(0)}%)`);
      }
      if (verdict.verdict === "regressed") {
        console.error(`devbench: '${verdict.key}' regressed. Fix it, or re-run with --record if the new number is the deliberate one.`);
        exitCode = 1;
      } else {
        console.log(`devbench: '${verdict.key}' within ${(100 * DEFAULT_TOLERANCE).toFixed(0)}% of the committed baseline.`);
      }
    }
  }
  setTimeout(() => { freePort(); child?.kill(); process.exit(exitCode); }, 1000);
}

if (AS_SCRIPT) {
  setTimeout(() => { console.error("devbench: timed out after 5min"); freePort(); child?.kill(); process.exit(1); }, 300_000);
}
