#!/usr/bin/env node
// devbench — measure what `next dev` actually costs, so dev-performance claims in
// docs/architecture/app-structure.md stay evidence-backed instead of folklore.
//
//   node scripts/perf/devbench.mjs <label> [--cold] [--burst]
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
// Appends one JSON row per run to .next/devbench.jsonl.
//
// WHY IT KILLS :3000 FIRST: Next allows one dev server per checkout (.next/dev/lock).
// The bench takes the port for the duration and frees it on exit — do not run it
// against a dev server you care about; start yours again afterwards.

import { spawn, spawnSync } from "node:child_process";
import { rmSync, existsSync, renameSync, appendFileSync } from "node:fs";
import { join } from "node:path";

const label = process.argv[2] ?? "run";
const cold = process.argv.includes("--cold");
const burst = process.argv.includes("--burst");
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

freePort();
if (cold) rmSync(join(ROOT, ".next", "dev", "cache", "turbopack"), { recursive: true, force: true });
// Rotate the trace so `.next/dev/trace` holds only this run's spans — it is the
// authoritative record when a dev-log number looks impossible (overlapping
// handle-request spans make one compile look like several separate slow requests).
if (existsSync(TRACE)) { try { renameSync(TRACE, `${TRACE}.${label}.bak`); } catch { /* in use */ } }

const t0 = Date.now();
let readyAt = null;
const child = spawn("npm", ["run", "dev"], { shell: true, cwd: ROOT, env: { ...process.env, FORCE_COLOR: "0" } });

let seen = "";
const onData = (b) => {
  seen += b.toString();
  if (readyAt === null && /Ready in/.test(seen)) { readyAt = Date.now(); measure(); }
};
child.stdout.on("data", onData);
child.stderr.on("data", onData);

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
  setTimeout(() => { freePort(); child.kill(); process.exit(code === 200 ? 0 : 1); }, 1000);
}

setTimeout(() => { console.error("devbench: timed out after 5min"); freePort(); child.kill(); process.exit(1); }, 300_000);
