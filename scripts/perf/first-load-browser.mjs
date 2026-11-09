#!/usr/bin/env node
// first-load-browser.mjs - the JavaScript a real browser downloads to open the workspace.
//
// first-load.mjs (its sibling) walks SOURCE: first-party bytes on disk, no minifier, no
// tree-shaking, no packages. This one measures the BUILT app over the wire with headless
// Chromium, so it sees what an operator actually pays on `/` (default tab):
//
//   * eager      - every script the document itself names (the <script src> tags and the
//                  chunk list in the inlined RSC payload): what the page needs to hydrate,
//                  default tab included. Read from the HTML, not from timing: a late
//                  `load` event on a busy machine let idle-time prefetches count as eager;
//   * settled    - every script requested until the network has been quiet for --idle-ms,
//                  which adds the idle-time tab warm-up (tabChunks.ts) and late islands.
//
// For each phase: script requests, bytes transferred (encoded, from CDP) and bytes decoded
// (the body), plus the top chunks by decoded size. A fresh browser context per run, so
// every run is cold (no HTTP cache, no service worker).
//
// It needs a production server it does not start itself. Never point it at the operator's
// dev server: a dev build measures the compiler, and its data is the operator's own. The
// isolated recipe (Windows: run from Git Bash; a throwaway DB, the .next-empty distDir):
//
//   KP_EMPTY=1 npx next build
//   KP_ALLOW_OPEN=1 KP_EMPTY=1 KP_DB_PATH=<scratch>/fl.sqlite npx next start --port 3317
//   node scripts/perf/first-load-browser.mjs --base-url http://localhost:3317 --runs 3
//
// KP_ALLOW_OPEN=1 because a keyless production server fails closed and the workspace
// would render its refusal states. KP_EMPTY=1 boots the DB blank; to measure against the
// demo corpus, seed the throwaway file first (KP_SEED_DEMO=1 and ensureDb() from
// app/_lib/db/core.ts, run once without KP_EMPTY). On 2026-11-09 the eager set measured
// the same to the byte with and without KP_ALLOW_OPEN; the settled set did not.
//
// Flags: --base-url (required), --path (default "/"), --runs (default 3), --top (default
// 15), --idle-ms (default 2000), --json <file> to write every run's rows, --anonymous to
// measure the public landing instead. '/' is gated: without --anonymous the script sets
// the open-mode `kp_entered` cookie and stamps onboarding "skipped" first, exactly as
// e2e/dev-auth.ts does, so it measures the workspace and not the landing or the setup
// wizard. Password-mode servers are out of scope.
//
// What it cannot see: CPU time (pair it with e2e/perf-vitals.spec.ts), CSS, fonts, and
// which source module sits in which chunk. To map a chunk back to modules, open the chunk
// in the build (<distDir>/static/chunks/<name>) or run `next analyze`.
import fs from 'node:fs';
import { chromium } from '@playwright/test';

function parseArgs(argv) {
  const out = { path: '/', runs: 3, top: 15, idleMs: 2000, json: null, baseUrl: null, anonymous: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i], v = argv[i + 1];
    if (k === '--base-url') { out.baseUrl = v; i++; }
    else if (k === '--path') { out.path = v; i++; }
    else if (k === '--runs') { out.runs = Number(v); i++; }
    else if (k === '--top') { out.top = Number(v); i++; }
    else if (k === '--idle-ms') { out.idleMs = Number(v); i++; }
    else if (k === '--json') { out.json = v; i++; }
    else if (k === '--anonymous') out.anonymous = true;
    else throw new Error(`unknown flag ${k}`);
  }
  if (!out.baseUrl) throw new Error('usage: first-load-browser.mjs --base-url http://localhost:<port> [--anonymous] [--path /] [--runs 3] [--top 15] [--idle-ms 2000] [--json out.json]');
  return out;
}

const kb = (n) => (n / 1024).toFixed(1);
const chunkName = (url) => new URL(url).pathname.replace(/^.*\/_next\/static\//, '');

async function oneRun(browser, opts) {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  if (!opts.anonymous) {
    await context.addCookies([{ name: 'kp_entered', value: '1', url: opts.baseUrl }]);
    await context.request.post(`${opts.baseUrl}/api/me/onboarding`, { data: { status: 'skipped' } }).catch(() => undefined);
  }
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });

  const scripts = new Map(); // requestId -> row
  let lastActivity = Date.now();
  cdp.on('Network.requestWillBeSent', (e) => {
    lastActivity = Date.now();
    if (e.type !== 'Script') return;
    scripts.set(e.requestId, { url: e.request.url, encoded: 0, decoded: 0, done: false });
  });
  cdp.on('Network.dataReceived', (e) => {
    lastActivity = Date.now();
    const row = scripts.get(e.requestId);
    if (row) row.decoded += e.dataLength;
  });
  cdp.on('Network.loadingFinished', (e) => {
    lastActivity = Date.now();
    const row = scripts.get(e.requestId);
    if (row) { row.encoded = e.encodedDataLength; row.done = true; }
  });

  const response = await page.goto(new URL(opts.path, opts.baseUrl).href, { waitUntil: 'load' });
  if (!response || !response.ok()) throw new Error(`GET ${opts.path} answered ${response?.status()}`);
  const html = await response.text();
  // Measuring the surface asked for: the public landing's root carries `.mk-land`, the
  // workspace's does not (both have a #main). Refuse a wrong page rather than report it.
  const isWorkspace = (await page.locator('.mk-land').count()) === 0;
  if (isWorkspace === opts.anonymous) throw new Error(`expected the ${opts.anonymous ? 'public landing' : 'workspace'} at ${opts.path}, got the other surface`);
  const timing = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0];
    return { domContentLoadedMs: Math.round(nav.domContentLoadedEventEnd), loadMs: Math.round(nav.loadEventEnd) };
  });
  while (Date.now() - lastActivity < opts.idleMs) await new Promise((r) => setTimeout(r, 100));
  await context.close();

  const rows = [...scripts.values()].filter((r) => r.done).map((r) => ({ ...r, eager: html.includes(new URL(r.url).pathname) }));
  const sum = (list, k) => list.reduce((s, r) => s + r[k], 0);
  const eager = rows.filter((r) => r.eager);
  return {
    timing,
    eager: { requests: eager.length, encoded: sum(eager, 'encoded'), decoded: sum(eager, 'decoded') },
    settled: { requests: rows.length, encoded: sum(rows, 'encoded'), decoded: sum(rows, 'decoded') },
    chunks: rows.map((r) => ({ chunk: chunkName(r.url), eager: r.eager, encoded: r.encoded, decoded: r.decoded })),
  };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const browser = await chromium.launch({ headless: true });
  const runs = [];
  try {
    for (let i = 0; i < opts.runs; i++) runs.push(await oneRun(browser, opts));
  } finally {
    await browser.close();
  }
  console.log(`first-load-browser ${opts.baseUrl}${opts.path} (${opts.anonymous ? 'public landing' : 'workspace'}) - ${opts.runs} cold run(s)\n`);
  console.log('run  eager req  eager KB (wire / decoded)  settled req  settled KB (wire / decoded)  DCL ms  load ms');
  runs.forEach((r, i) => {
    console.log(
      `${String(i + 1).padEnd(4)} ${String(r.eager.requests).padStart(9)}  ${`${kb(r.eager.encoded)} / ${kb(r.eager.decoded)}`.padStart(25)}  ` +
        `${String(r.settled.requests).padStart(11)}  ${`${kb(r.settled.encoded)} / ${kb(r.settled.decoded)}`.padStart(27)}  ` +
        `${String(r.timing.domContentLoadedMs).padStart(6)}  ${String(r.timing.loadMs).padStart(7)}`
    );
  });
  const last = runs[runs.length - 1];
  console.log(`\ntop ${opts.top} chunks by decoded size (last run; E = eager, s = settled only):`);
  for (const c of [...last.chunks].sort((a, b) => b.decoded - a.decoded).slice(0, opts.top)) {
    console.log(`  ${c.eager ? 'E' : 's'} ${kb(c.decoded).padStart(8)} KB decoded ${kb(c.encoded).padStart(7)} KB wire  ${c.chunk}`);
  }
  if (opts.json) fs.writeFileSync(opts.json, JSON.stringify({ baseUrl: opts.baseUrl, path: opts.path, runs }, null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
