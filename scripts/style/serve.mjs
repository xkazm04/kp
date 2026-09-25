#!/usr/bin/env node
// serve.mjs - run ONE command against a throwaway kp server, then take it down.
//
// The same rule shoot.mjs keeps: a copy of the data (SQLite online backup, the
// source opened read-only), `next start` over the current .next build on a free
// port (or `--server dev` on .next-empty), every targets.json surface resolved -
// seeds included - against that copy, and the server killed by PID on exit.
//
//   node scripts/style/serve.mjs [--db <sqlite>] [--server start|dev] [--env K=V ...] -- <command ...>
//
// The command gets KP_E2E_BASE_URL (so playwright.config.ts drops its own dev
// webServer) and KP_STYLE_TARGETS (a JSON file of resolved surfaces). Exit code is
// the command's. `npm run perf:vitals` is this wrapped around e2e/perf-vitals.spec.ts.
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { REPO, loadTargets, snapshotDb, startServer, throwawayFrom, removeDbFiles } from './lib/server.mjs';
import { resolveTarget } from './lib/resolve.mjs';

async function main(argv) {
  const sep = argv.indexOf('--');
  if (sep < 0 || sep === argv.length - 1) throw new Error('usage: serve.mjs [--db <sqlite>] [--server start|dev] [--env K=V] -- <command ...>');
  const own = argv.slice(0, sep);
  const cmd = argv.slice(sep + 1);
  const at = (k) => { const i = own.indexOf(k); return i >= 0 ? own[i + 1] : undefined; };
  const extraEnv = Object.fromEntries(own.flatMap((a, i) => (a === '--env' ? [own[i + 1].split(/=(.*)/s).slice(0, 2)] : [])));
  const work = path.join(os.tmpdir(), `kp-style-serve-${process.pid}`);
  mkdirSync(work, { recursive: true });
  const snapshot = path.join(work, 'kp-snapshot.sqlite');
  await snapshotDb(path.resolve(at('--db') ?? path.join(REPO, 'data', 'kp.sqlite')), snapshot);
  const dbFile = throwawayFrom(snapshot, work);
  const server = await startServer({ mode: at('--server') ?? 'start', dbFile, log: console.log });
  let code = 1;
  try {
    for (const w of server.warnings) console.log(`WARN ${w}`);
    await fetch(`${server.baseUrl}/api/me/onboarding`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: 'kp_entered=1' }, body: '{"status":"skipped"}' }).catch(() => {});
    const resolved = {};
    for (const [name, t] of Object.entries(loadTargets())) {
      try {
        const r = await resolveTarget(name, t, { dbFile, baseUrl: server.baseUrl });
        resolved[name] = { ...t, url: r.url, resolvedPath: r.path };
      } catch (err) {
        resolved[name] = { ...t, error: err.message };
        console.log(`WARN ${name}: ${err.message}`);
      }
    }
    const targetsFile = path.join(work, 'targets.resolved.json');
    writeFileSync(targetsFile, JSON.stringify({ baseUrl: server.baseUrl, server: { mode: server.mode, build: server.build }, targets: resolved }, null, 2));
    code = await new Promise((resolve) => {
      // One command string under a shell on Windows (npx is a .cmd there); an
      // argv array plus shell:true is deprecated (DEP0190) and escapes nothing.
      const win = process.platform === 'win32';
      const child = spawn(win ? cmd.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ') : cmd[0], win ? [] : cmd.slice(1), {
        cwd: REPO, stdio: 'inherit', shell: win,
        env: { ...process.env, ...extraEnv, KP_E2E_BASE_URL: server.baseUrl, KP_STYLE_TARGETS: targetsFile },
      });
      child.on('exit', (c) => resolve(c ?? 1));
      child.on('error', () => resolve(1));
    });
  } finally {
    server.stop();
    removeDbFiles(dbFile);
    try { rmSync(work, { recursive: true, force: true }); } catch { /* best-effort: a temp dir */ }
  }
  return code;
}

main(process.argv.slice(2)).then((c) => { process.exitCode = c; }, (err) => { console.error(err?.message ?? String(err)); process.exitCode = 1; });
