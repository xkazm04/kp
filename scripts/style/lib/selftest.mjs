// --self-test: prove every failure mode of shoot.mjs still fires, against ONE
// throwaway server. A case passes only when the run fails FOR ITS OWN REASON
// (the matching problem is in the report), never merely because something else
// broke - and a control case must come back green, or "everything fails" would
// read as "every detector works".
import os from 'node:os';
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { REPO, snapshotDb, startServer, throwawayFrom, removeDbFiles } from './server.mjs';

const after = (js) => ({ content: `window.addEventListener('DOMContentLoaded', () => { ${js} });` });

const CASES = [
  { name: 'control (a real surface must pass)', expect: 0, opts: { names: ['settings-hiring'] } },
  { name: 'unknown target', expect: 1, match: /unknown target/, opts: { names: ['no-such-surface'] } },
  {
    name: 'empty mount (root absent)', expect: 1, match: /empty mount/,
    opts: { targetsOverride: { 'selftest-empty': { path: '/?tab=hiring', root: '#__style_selftest_no_such_root__' } } },
  },
  {
    name: 'console error', expect: 1, match: /console: style self-test/,
    opts: { names: ['settings-hiring'], init: after("console.error('style self-test: forced console error')") },
  },
  {
    name: 'failed /api request', expect: 1, match: /api 404: \/api\/__style_selftest_missing__/,
    opts: { names: ['settings-hiring'], init: after("fetch('/api/__style_selftest_missing__').catch(() => {})") },
  },
];

export async function runSelfTest({ runShoot, outRoot }) {
  const root = path.resolve(outRoot ?? path.join(os.tmpdir(), `kp-style-selftest-${process.pid}`));
  mkdirSync(root, { recursive: true });
  const snapshot = path.join(root, 'kp-snapshot.sqlite');
  await snapshotDb(path.join(REPO, 'data', 'kp.sqlite'), snapshot);
  const dbFile = throwawayFrom(snapshot, path.join(root, '.throwaway'));
  const server = await startServer({ dbFile, log: console.log });
  let failed = 0;
  try {
    for (const c of CASES) {
      const opts = { ...c.opts, out: path.join(root, c.name.replace(/\W+/g, '-')), baseUrl: server.baseUrl, db: dbFile, sizes: '1280x800', themes: 'light', clock: 'off' };
      const lines = [];
      let code;
      let reason = '';
      try {
        code = await runShoot(opts, (l) => lines.push(l));
        reason = (opts.lastReport?.shots ?? []).flatMap((s) => s.problems ?? []).join(' | ');
      } catch (err) {
        code = 1;
        reason = String(err?.message ?? err);
      }
      const ok = code === c.expect && (!c.match || c.match.test(reason));
      if (!ok) failed++;
      console.log(`${ok ? 'ok  ' : 'FAIL'} ${c.name}: exit ${code} (want ${c.expect})${reason ? `  <- ${reason.slice(0, 220)}` : ''}`);
    }
  } finally {
    server.stop();
    removeDbFiles(dbFile);
  }
  console.log(failed ? `self-test: ${failed} case(s) did not behave` : `self-test: all ${CASES.length} cases behaved (control green, every failure mode fired for its own reason)`);
  return failed ? 1 : 0;
}
