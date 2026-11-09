#!/usr/bin/env node
// How long does a spawned jobfit CLI spend importing before it does any work?
//
// ADR 0003 makes the Python pipeline a process spawned PER REQUEST, so every
// interactive route that reaches the engine pays interpreter start-up plus the
// import graph of its CLI before the first useful line runs. This script measures
// that import cost for every entry point the app actually spawns, so a change that
// makes a cold start cheaper (or dearer) has a number on it.
//
// WHAT IT MEASURES, per entry point, over --runs runs (default 5, after one
// discarded warm-up run that also refreshes the bytecode cache):
//   import ms   the CUMULATIVE `-X importtime` figure of the entry module itself:
//               everything its import pulled in that the bare interpreter had not
//               already loaded. Median of the runs.
//   wall ms     the wall clock of `python -c "import <module>"`, interpreter start
//               included. Median of the runs. The floor (`python -c pass`) is
//               printed above the table so the import share is visible.
//   top self    the modules with the largest median SELF time across the runs:
//               where the time goes, not just how much.
//
// WHICH ENTRY POINTS. Derived from the source, not listed by hand: every
// `"pipeline.jobfit.<x>"` string ending in `cli` under app/ (non-test .ts), and
// every `module: "<x>_cli"` handed to the jobseeker/gigs python-cli helper. A new
// spawn site is therefore measured without anyone editing this file.
//
// It is an instrument, not a gate: wall-clock figures on a shared box flap, so
// nothing in CI runs it. The gate that keeps the win is the Python test
// pipeline/jobfit/tests/test_cli_import_weight.py, which asserts on sys.modules
// (deterministic) rather than on milliseconds.
//
// Usage:
//   node scripts/perf/python-import-time.mjs [--runs N] [--json] [--top K] [--only a,b]
//                                            [--baseline <dir>]
//
// --baseline <dir> measures a SECOND tree (a directory holding another copy of
// `pipeline/`, e.g. `git archive <rev> pipeline | tar -x -C <dir>` plus a link to
// `data/`) in the same session, alternating run by run with this checkout, and prints
// both columns. On a shared box the load moves under a measurement; interleaving is
// what makes a before/after pair comparable.
//
// The interpreter is KP_PYTHON / PYTHON_CMD when set, else `python` (`python3` off
// Windows), mirroring app/_lib/python-runner.ts closely enough for a measurement.

import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function parseArgs(argv) {
  const out = { runs: 5, json: false, top: 6, only: null, baseline: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--runs") out.runs = Math.max(1, Number(argv[++i]) || 5);
    else if (a === "--baseline") out.baseline = path.resolve(String(argv[++i] ?? ""));
    else if (a === "--json") out.json = true;
    else if (a === "--top") out.top = Math.max(0, Number(argv[++i]) || 0);
    else if (a === "--only") out.only = String(argv[++i] ?? "").split(",").filter(Boolean);
  }
  return out;
}

function walk(dir, files = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = path.join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, files);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) files.push(p);
  }
  return files;
}

/** Every jobfit entry module the app spawns, sorted. */
export function spawnedEntryPoints(appDir = path.join(REPO, "app")) {
  const found = new Set();
  const dotted = /"pipeline\.jobfit\.([a-z_.]*cli)"/g;
  const helper = /module:\s*"([a-z_]+_cli)"/g;
  for (const file of walk(appDir)) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(dotted)) found.add(`pipeline.jobfit.${m[1]}`);
    for (const m of src.matchAll(helper)) found.add(`pipeline.jobfit.${m[1]}`);
  }
  return [...found].sort();
}

const python = process.env.KP_PYTHON?.trim() || process.env.PYTHON_CMD?.trim() || (process.platform === "win32" ? "python" : "python3");
const ENV = { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" };

/** One `-X importtime` line: `import time: self | cumulative | <indent>name`. */
const LINE = /^import time:\s+(\d+)\s+\|\s+(\d+)\s+\|(\s*)(\S+)\s*$/;

function runOnce(code, importtime, cwd = REPO) {
  const args = [...(importtime ? ["-X", "importtime"] : []), "-c", code];
  const t0 = process.hrtime.bigint();
  const res = spawnSync(python, args, { cwd, env: ENV, encoding: "utf8", windowsHide: true });
  const wallMs = Number(process.hrtime.bigint() - t0) / 1e6;
  if (res.status !== 0) {
    const tail = String(res.stderr ?? "").trim().split(/\r?\n/).filter((l) => !LINE.test(l)).slice(-3).join(" | ");
    throw new Error(`${code} exited ${res.status}: ${tail}`);
  }
  return { wallMs, stderr: String(res.stderr ?? "") };
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  return n === 0 ? 0 : n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
};

function newSample() {
  return { cumulative: [], walls: [], self: new Map() };
}

/** One wall-clock run and one importtime run of `import <mod>` in `cwd`, into `s`. */
function sampleOnce(mod, cwd, s) {
  const code = `import ${mod}`;
  // Wall clock WITHOUT importtime (its own logging costs a little).
  s.walls.push(runOnce(code, false, cwd).wallMs);
  const { stderr } = runOnce(code, true, cwd);
  let cum = 0;
  for (const raw of stderr.split(/\r?\n/)) {
    const m = LINE.exec(raw);
    if (!m) continue;
    const name = m[4];
    if (!s.self.has(name)) s.self.set(name, []);
    s.self.get(name).push(Number(m[1]));
    if (name === mod) cum = Number(m[2]);
  }
  s.cumulative.push(cum / 1000);
}

function summarize(mod, s, runs, top) {
  const topSelf = [...s.self.entries()]
    .map(([name, xs]) => ({ name, ms: median([...xs, ...Array(Math.max(0, runs - xs.length)).fill(0)]) / 1000 }))
    .sort((a, b) => b.ms - a.ms)
    .slice(0, top);
  return { module: mod, importMs: median(s.cumulative), wallMs: median(s.walls), topSelf };
}

/** Measure `mod` in this checkout and, when given, in `baseline`, alternating runs. */
function measure(mod, runs, top, baseline) {
  const roots = baseline ? [REPO, baseline] : [REPO];
  const samples = roots.map(() => newSample());
  for (const root of roots) runOnce(`import ${mod}`, true, root); // warm-up: page cache + __pycache__
  for (let i = 0; i < runs; i++) roots.forEach((root, k) => sampleOnce(mod, root, samples[k]));
  const [current, base] = samples.map((s) => summarize(mod, s, runs, top));
  return { ...current, baseline: base ?? null };
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  let mods = spawnedEntryPoints();
  if (opts.only) mods = mods.filter((m) => opts.only.some((o) => m === o || m.endsWith(`.${o}`)));
  runOnce("pass", false);
  const floor = median(Array.from({ length: opts.runs }, () => runOnce("pass", false).wallMs));
  const rows = mods.map((m) => measure(m, opts.runs, opts.top, opts.baseline));
  if (opts.json) {
    process.stdout.write(`${JSON.stringify({ python, runs: opts.runs, floorMs: floor, baseline: opts.baseline, rows }, null, 2)}\n`);
    return;
  }
  const f = (x) => x.toFixed(0).padStart(5);
  const name = (m) => m.replace("pipeline.jobfit.", "");
  console.log(`python: ${python}   runs: ${opts.runs} (median)   interpreter floor (python -c pass): ${floor.toFixed(0)} ms\n`);
  if (opts.baseline) {
    console.log(`baseline tree: ${opts.baseline}\n`);
    console.log("| entry point | import ms before | import ms after | wall ms before | wall ms after | top self time after (ms) |");
    console.log("| --- | ---: | ---: | ---: | ---: | --- |");
    for (const r of rows) {
      const tops = r.topSelf.map((t) => `${t.name} ${t.ms.toFixed(0)}`).join(", ");
      const b = r.baseline;
      console.log(`| ${name(r.module)} | ${f(b.importMs)} | ${f(r.importMs)} | ${f(b.wallMs)} | ${f(r.wallMs)} | ${tops} |`);
    }
    const sum = (k, pick) => rows.reduce((acc, r) => acc + pick(r)[k], 0);
    console.log(`| **sum** | ${f(sum("importMs", (r) => r.baseline))} | ${f(sum("importMs", (r) => r))} | ${f(sum("wallMs", (r) => r.baseline))} | ${f(sum("wallMs", (r) => r))} | |`);
    return;
  }
  console.log("| entry point | import ms | wall ms | top self time (ms) |");
  console.log("| --- | ---: | ---: | --- |");
  for (const r of rows) {
    const tops = r.topSelf.map((t) => `${t.name} ${t.ms.toFixed(0)}`).join(", ");
    console.log(`| ${name(r.module)} | ${f(r.importMs)} | ${f(r.wallMs)} | ${tops} |`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
