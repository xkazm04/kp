// A throwaway kp server for the style instruments: never the operator's.
//
// The operator's `npm run dev` holds `.next/dev/lock` and serves data/kp.sqlite;
// `npm run dev:empty` holds `.next-empty`. A THIRD `next dev` cannot start in this
// checkout (Next allows one dev server per distDir, and next.config.ts only knows
// those two), so the default here is `next start` over the current production
// build in `.next` — which is also what a perf number should be measured on.
// `--server dev` uses the `.next-empty` dist dir when nobody else holds it.
//
// Data: the source database is COPIED with SQLite's online backup (WAL-safe, the
// source is opened read-only and never written) to a snapshot, and the snapshot is
// copied again to the throwaway file the server writes into. Keep the snapshot and
// hand it back as `--db` for the AFTER half of a pair: same rows in, so a pixel
// delta means the code changed and not the data.
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const TARGETS_FILE = path.join(REPO, 'scripts', 'style', 'targets.json');
const NEXT_BIN = path.join(REPO, 'node_modules', 'next', 'dist', 'bin', 'next');
// A fixed, non-secret signing key for the THROWAWAY server only, so a skill card
// minted here verifies on the same run and on the AFTER run alike.
const THROWAWAY_SKILL_KEY = 'kp-style-instruments-throwaway-signing-key';

export function loadTargets(file = TARGETS_FILE) {
  const doc = JSON.parse(readFileSync(file, 'utf8'));
  if (doc.version !== 1 || !doc.targets || typeof doc.targets !== 'object') throw new Error(`${file}: not a v1 targets registry`);
  return doc.targets;
}

/** Online-backup copy of a (possibly live, WAL-mode) SQLite file. */
export async function snapshotDb(source, dest) {
  const { default: Database } = await import('better-sqlite3');
  mkdirSync(path.dirname(dest), { recursive: true });
  const src = new Database(source, { readonly: true, fileMustExist: true });
  try {
    await src.backup(dest);
  } finally {
    src.close();
  }
  return { path: dest, sha256: createHash('sha256').update(readFileSync(dest)).digest('hex').slice(0, 16), bytes: statSync(dest).size };
}

export function freePort(start = 3600) {
  return new Promise((resolve, reject) => {
    const tryPort = (p) => {
      if (p > start + 200) return reject(new Error(`no free port in ${start}..${start + 200}`));
      const s = net.createServer();
      s.once('error', () => tryPort(p + 1));
      s.listen(p, '0.0.0.0', () => s.close(() => resolve(p)));
    };
    tryPort(start);
  });
}

export function buildInfo() {
  const id = path.join(REPO, '.next', 'BUILD_ID');
  if (!existsSync(id)) return null;
  return { id: readFileSync(id, 'utf8').trim(), builtAt: statSync(id).mtime.toISOString() };
}

function headCommitTime() {
  const r = spawnSync('git', ['log', '-1', '--format=%cI'], { cwd: REPO, encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}

/**
 * Start `next start` (mode "start") or `next dev` on .next-empty (mode "dev") on a
 * free port over `dbFile`. Resolves once the server answers HTTP. The returned
 * `stop()` kills the whole process tree BY PID.
 */
export async function startServer({ mode = 'start', dbFile, port, log = () => {} }) {
  const warnings = [];
  if (mode === 'start') {
    const info = buildInfo();
    if (!info) throw new Error('no production build in .next (run `npm run build` first; see docs/design/instruments.md for a tree whose typecheck is red)');
    const head = headCommitTime();
    if (head && new Date(info.builtAt) < new Date(head)) warnings.push(`stale build: .next was built ${info.builtAt}, before HEAD (${head}); rebuild before a gate shot`);
  }
  const p = port ?? (await freePort());
  const args = mode === 'dev' ? [NEXT_BIN, 'dev', '--port', String(p)] : [NEXT_BIN, 'start', '--port', String(p)];
  const env = {
    ...process.env,
    KP_DB_PATH: dbFile,
    // Open mode on purpose: process env wins over .env.local, so an operator
    // password there cannot wall the throwaway server. It serves a scratch copy.
    KP_OPERATOR_PASSWORD: '',
    KP_ALLOW_OPEN: '1',
    KP_OFFLINE: '1',
    KP_SKILL_PROFILE_KEY: process.env.KP_SKILL_PROFILE_KEY || THROWAWAY_SKILL_KEY,
    ...(mode === 'dev' ? { KP_EMPTY: '1' } : {}),
  };
  const child = spawn(process.execPath, args, { cwd: REPO, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let output = '';
  const onData = (d) => { output += d; if (output.length > 20000) output = output.slice(-10000); };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  let exited = null;
  child.on('exit', (code) => { exited = code ?? -1; });
  const baseUrl = `http://localhost:${p}`;
  const stop = () => {
    if (exited !== null) return;
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
    else child.kill('SIGTERM');
  };
  const deadline = Date.now() + (mode === 'dev' ? 180_000 : 90_000);
  while (Date.now() < deadline) {
    if (exited !== null) throw new Error(`server exited (${exited}) before answering:\n${output.slice(-3000)}`);
    try {
      const res = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(5000) });
      if (res.status < 500) {
        log(`server: ${mode} pid ${child.pid} on ${baseUrl} (db ${dbFile})`);
        return { baseUrl, pid: child.pid, stop, warnings, mode, build: buildInfo() };
      }
    } catch { /* not listening yet */ }
    await new Promise((r) => setTimeout(r, 750));
  }
  stop();
  throw new Error(`server did not answer within the deadline:\n${output.slice(-3000)}`);
}

/** Fresh throwaway file from the snapshot (the server writes; the snapshot stays pristine). */
export function throwawayFrom(snapshot, dir) {
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `kp-throwaway-${process.pid}-${Date.now()}.sqlite`);
  copyFileSync(snapshot, file);
  return file;
}

export function removeDbFiles(file) {
  for (const f of [file, `${file}-wal`, `${file}-shm`]) {
    try { rmSync(f, { force: true }); } catch { /* best-effort: a scratch file */ }
  }
}
