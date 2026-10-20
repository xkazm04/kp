#!/usr/bin/env node
// shoot.mjs - see a kp surface the way the owner will: full-page PNGs of named
// surfaces (scripts/style/targets.json) at three frames x both themes, from a
// THROWAWAY server over a COPY of the data. docs/design/instruments.md is the
// operator page.
//
//   node scripts/style/shoot.mjs --out <dir> [channels offer ...]      # all targets when none named
//   node scripts/style/shoot.mjs --out <after> --db <before>/kp-snapshot.sqlite channels   # AFTER, same rows
//   node scripts/style/shoot.mjs --pair <beforeDir> <afterDir> --out <dir>
//   node scripts/style/shoot.mjs --self-test      # proves every failure mode still fires
//   node scripts/style/shoot.mjs --dry-run [targets]   # the plan; no server, no browser
//
// Options: --sizes 1280x800,1728x1080,1440x3200  --themes light,dark  --settle 800
//          --db <sqlite> (default data/kp.sqlite, opened read-only and copied)
//          --server start|dev (default start: `next start` over the current .next build)
//          --base-url <url> (reuse a running server; --db then names ITS database, read-only, and seeds are refused)
//          --clock <iso>|off (default: the snapshot's time, reused by the AFTER run)
//
// Output: <target>-<W>x<H>-<theme>.png, shoot-report.json, kp-snapshot.sqlite (the data "tape").
// Exit 1 on any failed shot (console error, failed /api request, empty mount, wrong theme).
import { mkdirSync, existsSync, readFileSync, rmdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REPO, loadTargets, snapshotDb, startServer, throwawayFrom, removeDbFiles, buildInfo } from './lib/server.mjs';
import { resolveTarget } from './lib/resolve.mjs';
import { launchBrowser, shootOne } from './lib/capture.mjs';
import { runPair } from './lib/pair.mjs';
import { runSelfTest } from './lib/selftest.mjs';

const DEFAULT_SIZES = '1280x800,1728x1080,1440x3200';

const FLAGS = new Set(['dry-run', 'self-test', 'allow-browser-drift']);

export function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { out._.push(a); continue; }
    const next = argv[i + 1];
    if (FLAGS.has(a.slice(2)) || next === undefined || next.startsWith('--')) out[a.slice(2)] = true;
    else { out[a.slice(2)] = next; i++; }
  }
  return out;
}

const str = (v, d) => (typeof v === 'string' ? v : d);
export const parseSizes = (s) => s.split(',').map((v) => {
  const [width, height] = v.split('x').map(Number);
  if (!width || !height) throw new Error(`bad size "${v}"`);
  return { width, height };
});

/** Pick targets by name; an unknown name is a failure, never a silent skip. */
export function pickTargets(all, names) {
  const unknown = names.filter((n) => !all[n]);
  if (unknown.length) throw new Error(`unknown target(s): ${unknown.join(', ')} (known: ${Object.keys(all).join(', ')})`);
  return (names.length ? names : Object.keys(all)).map((name) => [name, all[name]]);
}

export async function runShoot(opts, log = console.log) {
  const all = opts.targetsOverride ?? loadTargets();
  const picked = pickTargets(all, opts.names ?? []);
  const sizes = parseSizes(opts.sizes ?? DEFAULT_SIZES);
  const themes = (opts.themes ?? 'light,dark').split(',');
  const source = path.resolve(opts.db ?? path.join(REPO, 'data', 'kp.sqlite'));
  if (opts.dryRun) {
    log(`plan: ${opts.baseUrl ? `reuse ${opts.baseUrl}` : `${opts.server ?? 'start'} server on a free port`} over a copy of ${source}`);
    if (!opts.baseUrl && (opts.server ?? 'start') === 'start') log(`build: ${JSON.stringify(buildInfo())}`);
    for (const [name, t] of picked) {
      const r = await resolveTarget(name, t, { dbFile: source, dryRun: true }).catch((e) => ({ path: `UNRESOLVED: ${e.message}` }));
      log(`  ${name.padEnd(16)} ${r.path}  root=${t.root}${t.gate ? '  [gate]' : ''}`);
      for (const th of themes) for (const s of sizes) log(`      -> ${name}-${s.width}x${s.height}-${th}.png`);
    }
    return 0;
  }
  if (!opts.out) throw new Error('--out <dir> is required');
  const outDir = path.resolve(opts.out);
  mkdirSync(outDir, { recursive: true });
  let server = null, dbFile = source, snapshot = null;
  const prior = path.join(path.dirname(source), 'shoot-report.json');
  const clock = opts.clock === 'off' ? null
    : str(opts.clock, null) ?? (existsSync(prior) ? JSON.parse(readFileSync(prior, 'utf8')).clock : null) ?? new Date(Math.floor(Date.now() / 60000) * 60000).toISOString();
  const shots = [];
  let browser = null;
  try {
    if (opts.baseUrl) {
      server = { baseUrl: opts.baseUrl.replace(/\/$/, ''), warnings: [], mode: 'reused', stop: () => {} };
    } else {
      snapshot = path.join(outDir, 'kp-snapshot.sqlite');
      const snap = await snapshotDb(source, snapshot);
      log(`data: ${source} -> ${snapshot} (${snap.bytes} B, sha256 ${snap.sha256})`);
      dbFile = throwawayFrom(snapshot, path.join(outDir, '.throwaway'));
      server = await startServer({ mode: opts.server ?? 'start', dbFile, log });
    }
    for (const w of server.warnings) log(`WARN ${w}`);
    await fetch(`${server.baseUrl}/api/me/onboarding`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: 'kp_entered=1' }, body: '{"status":"skipped"}' }).catch(() => {});
    browser = await launchBrowser();
    let warmed = false;
    for (const [name, target] of picked) {
      let resolved;
      try {
        // A reused server's database is not this run's to write: no seeds there.
        resolved = await resolveTarget(name, opts.baseUrl ? { ...target, seed: null } : target, { dbFile, baseUrl: server.baseUrl });
      } catch (err) {
        shots.push({ target: name, ok: false, problems: [`unresolved: ${err.message}`] });
        log(`FAIL ${name}: ${err.message}`);
        continue;
      }
      if (!warmed) { // discarded: the first render of a run is a cold one
        await shootOne(browser, { baseUrl: server.baseUrl, url: resolved.url, target, theme: themes[0], size: sizes[0], settle: 200, clock, init: opts.init });
        warmed = true;
      }
      for (const theme of themes) for (const size of sizes) {
        const file = `${name}-${size.width}x${size.height}-${theme}.png`;
        const r = await shootOne(browser, { baseUrl: server.baseUrl, url: resolved.url, target, theme, size, settle: Number(opts.settle) || undefined, clock, init: opts.init });
        writeFileSync(path.join(outDir, file), r.png);
        const ok = r.problems.length === 0;
        shots.push({ target: name, file, theme, size, path: resolved.path, seeded: resolved.seeded, ok, problems: r.problems, notes: r.notes, stable: r.stable, probe: r.probe });
        log(`${ok ? 'ok  ' : 'FAIL'} ${file}  ${r.probe.rootHeight}px root, ${r.probe.textLength} chars${r.problems.length ? `  ${r.problems.join('; ')}` : ''}${r.notes.length ? `  (${r.notes.join('; ')})` : ''}`);
      }
    }
  } finally {
    const version = browser?.version() ?? null;
    await browser?.close();
    server?.stop();
    if (dbFile !== source) {
      removeDbFiles(dbFile);
      try { rmdirSync(path.dirname(dbFile)); } catch { /* not empty, or already gone: leave it */ }
    }
    const report = { createdAt: new Date().toISOString(), browser: version, clock, server: server && { mode: server.mode, build: server.build ?? null, warnings: server.warnings }, data: { source, snapshot }, ok: shots.length > 0 && shots.every((s) => s.ok), shots };
    writeFileSync(path.join(outDir, 'shoot-report.json'), JSON.stringify(report, null, 2));
    log(`report: ${path.join(outDir, 'shoot-report.json')}`);
    opts.lastReport = report;
  }
  return opts.lastReport.ok ? 0 : 1;
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  if (a['self-test']) return runSelfTest({ runShoot, outRoot: str(a.out, null) });
  if (a.pair) {
    const [beforeDir, afterDir] = typeof a.pair === 'string' ? [a.pair, a._[0]] : a._;
    if (!beforeDir || !afterDir || typeof a.out !== 'string') throw new Error('--pair <beforeDir> <afterDir> --out <dir>');
    return runPair({ beforeDir: path.resolve(beforeDir), afterDir: path.resolve(afterDir), outDir: path.resolve(a.out), allowBrowserDrift: !!a['allow-browser-drift'] });
  }
  return runShoot({
    names: a._, out: str(a.out, null), sizes: str(a.sizes), themes: str(a.themes), db: str(a.db), server: str(a.server),
    baseUrl: str(a['base-url'], null), settle: str(a.settle), clock: str(a.clock, null), dryRun: !!a['dry-run'],
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => { process.exitCode = code ?? 0; }, (err) => { console.error(err?.stack ?? String(err)); process.exitCode = 1; });
}
