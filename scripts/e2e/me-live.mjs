#!/usr/bin/env node
// me-live — the ONE command for the live job-seeker e2e (e2e/jobseeker-live.spec.ts):
// boot an ISOLATED dev server, walk /me with the operator's real CV against real job
// boards, take the server down again.
//
//   KP_ME_LIVE_CV=/path/to/your-cv.pdf node scripts/e2e/me-live.mjs
//
// Env (only the first is required; the KP_ME_LIVE_* rest pass through to the spec):
//   KP_ME_LIVE_CV         the CV file (.pdf .docx .txt .md within the upload limit). This
//                         script checks it exists and never prints its path or name.
//   KP_ME_LIVE_PORT       the isolated server's port (default 3107)
//   KP_ME_LIVE_COUNTRIES / KP_ME_LIVE_TITLES / KP_ME_LIVE_BOARDS — see the spec's header
//
// ISOLATION, piece by piece:
//   - data/kp-me-live.sqlite, deleted with its -wal/-shm before every run: the spec needs a
//     FRESH seeker and refuses a server that already has one. KEPT after the run for
//     inspection; the next run deletes it. Never data/kp.sqlite.
//   - KP_EMPTY=1: no demo corpus is seeded (app/_lib/db/seed-gate.ts), and next.config.ts
//     moves the distDir to .next-empty, so this server never contends for the operator's
//     .next and never disturbs their running dev server.
//   - KP_JOBSEEKER=1: the module is off unless the install turns it on (jobseeker/enabled.ts).
//   - KP_OPERATOR_PASSWORD="" and KP_OFFLINE=0 are set on the process, which wins over
//     .env.local: the walk signs nobody in, and a live scan told to stay offline proves
//     nothing. DEV_INSPECT=0: no source-location loader slowing the compiles.
//
// It REFUSES rather than kills. Next allows one dev server per distDir, so a live
// .next-empty/dev/lock (npm run dev:empty, another me-live, an instrument's dev server) or a
// taken port ends this run with the holder's pid and command line. Stopping that process is
// the operator's call, never this script's.
//
// Exit codes: 2 = no usable KP_ME_LIVE_CV (nothing was started); 3 = refused, the port or the
// .next-empty lock is taken (nothing was started or deleted); 1 = the server did not come up;
// otherwise Playwright's own code. Deliberately not in CI and not in the keyless release
// gate: see the spec's header.
import { spawn, spawnSync } from "node:child_process";
import { createWriteStream, existsSync, readFileSync, rmSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const NEXT_BIN = path.join(ROOT, "node_modules", "next", "dist", "bin", "next");
const DB = path.join(ROOT, "data", "kp-me-live.sqlite");
const LOCK = path.join(ROOT, ".next-empty", "dev", "lock");
const OUT = path.join(ROOT, "test-results", "me-live");
// `dev-server*.log` is gitignored at any depth; outside test-results/ on purpose, because
// Playwright empties that directory when it starts — while this file is still being written.
const SERVER_LOG = path.join(ROOT, "data", "dev-server-me-live.log");
const BOOT_TIMEOUT_MS = 10 * 60_000;
const isWin = process.platform === "win32";

const say = (msg) => console.log(`[me-live] ${msg}`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const rel = (p) => path.relative(ROOT, p) || p;

// ── 1. the CV: required, and checked before anything starts ──────────────────────────────

/** The upload contract, read from its one source (app/_lib/upload-constraints.ts) rather
 *  than restated here, so a widened contract cannot be refused by a stale copy. */
function uploadContract() {
  try {
    const src = readFileSync(path.join(ROOT, "app", "_lib", "upload-constraints.ts"), "utf8");
    const exts = /ACCEPT_EXTENSIONS\s*=\s*"([^"]+)"/.exec(src)?.[1]?.split(",").map((e) => e.trim().toLowerCase()) ?? null;
    const mb = Number(/MAX_FILE_MB\s*=\s*(\d+)/.exec(src)?.[1]) || null;
    return { exts, mb };
  } catch {
    // Unreadable: the drop itself still refuses a wrong file, just later.
    return { exts: null, mb: null };
  }
}

function requireCv() {
  const raw = process.env.KP_ME_LIVE_CV?.trim();
  const usage = [
    "",
    "  KP_ME_LIVE_CV=/path/to/your-cv.pdf node scripts/e2e/me-live.mjs",
    "",
    "  The live /me walk reads YOUR CV: it is never committed, and the report and screenshots",
    "  stay in test-results/me-live/ (gitignored). Nothing was started.",
  ].join("\n");
  if (!raw) {
    console.error(`[me-live] KP_ME_LIVE_CV is not set.\n${usage}`);
    process.exit(2);
  }
  // npm runs scripts from the package root; a relative path means the caller's directory.
  const file = path.resolve(process.env.INIT_CWD ?? process.cwd(), raw);
  if (!existsSync(file) || !statSync(file).isFile()) {
    console.error(`[me-live] KP_ME_LIVE_CV does not name a readable file.\n${usage}`);
    process.exit(2);
  }
  const { exts, mb } = uploadContract();
  const ext = path.extname(file).toLowerCase();
  const size = statSync(file).size;
  if (exts && !exts.includes(ext)) {
    console.error(`[me-live] the CV is a ${ext || "file with no extension"}; the drop takes ${exts.join(" ")}. Nothing was started.`);
    process.exit(2);
  }
  if (mb && size > mb * 1024 * 1024) {
    console.error(`[me-live] the CV is ${(size / 1024 / 1024).toFixed(1)} MB; the drop takes at most ${mb} MB. Nothing was started.`);
    process.exit(2);
  }
  say(`CV: a ${ext} file of ${Math.max(1, Math.ceil(size / 1024))} KB (from KP_ME_LIVE_CV)`);
  return file;
}

function requirePort() {
  const raw = process.env.KP_ME_LIVE_PORT?.trim() || "3107";
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error(`[me-live] KP_ME_LIVE_PORT=${raw} is not a port. Nothing was started.`);
    process.exit(2);
  }
  return port;
}

// ── 2. is anything in the way? name it, never kill it ────────────────────────────────────

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: it exists and belongs to someone else. Anything else: it is gone.
    return error?.code === "EPERM";
  }
}

function describePid(pid) {
  if (isWin) {
    const r = spawnSync(
      "powershell",
      ["-NoProfile", "-Command", `Get-CimInstance Win32_Process -Filter "ProcessId=${pid}" | ForEach-Object { "$($_.Name) (parent $($_.ParentProcessId)): $($_.CommandLine)" }`],
      { encoding: "utf8", timeout: 15_000, windowsHide: true }
    );
    return String(r.stdout || "").trim() || "(no process details: it may have just exited)";
  }
  const r = spawnSync("ps", ["-o", "pid=,ppid=,command=", "-p", String(pid)], { encoding: "utf8" });
  return String(r.stdout || "").trim() || "(no process details: it may have just exited)";
}

function portHolders(port) {
  if (isWin) {
    const r = spawnSync(
      "powershell",
      ["-NoProfile", "-Command", `Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique`],
      { encoding: "utf8", timeout: 15_000, windowsHide: true }
    );
    return String(r.stdout || "").split(/\s+/).map(Number).filter((n) => Number.isInteger(n) && n > 0);
  }
  const r = spawnSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], { encoding: "utf8" });
  return String(r.stdout || "").split(/\s+/).map(Number).filter((n) => Number.isInteger(n) && n > 0);
}

/** Something already answers on the port (either loopback family). */
function portAnswers(port) {
  const probe = (host) =>
    new Promise((resolve) => {
      const socket = net.connect({ host, port });
      const done = (answer) => {
        socket.destroy();
        resolve(answer);
      };
      socket.setTimeout(1500, () => done(false));
      socket.once("connect", () => done(true));
      socket.once("error", () => done(false));
    });
  return Promise.all([probe("127.0.0.1"), probe("::1")]).then((r) => r.some(Boolean));
}

/** The dev lock, when a LIVE process holds it: Next writes {pid, appUrl, startedAt} into it. */
function lockHolder() {
  if (!existsSync(LOCK)) return null;
  try {
    const info = JSON.parse(readFileSync(LOCK, "utf8"));
    return Number.isInteger(info?.pid) && pidAlive(info.pid) ? info : null;
  } catch {
    // Unreadable or not JSON: a stale file from a crashed server; Next re-acquires it.
    return null;
  }
}

async function refuseIfBusy(port) {
  const reasons = [];
  const lock = lockHolder();
  if (lock) {
    reasons.push(
      [
        `${rel(LOCK)} is held: another \`next dev\` owns the .next-empty distDir, and Next allows one per distDir.`,
        `    pid ${lock.pid}${lock.appUrl ? ` · ${lock.appUrl}` : ""}${lock.startedAt ? ` · started ${new Date(lock.startedAt).toISOString()}` : ""}`,
        `    ${describePid(lock.pid)}`,
      ].join("\n")
    );
  }
  if (await portAnswers(port)) {
    const pids = portHolders(port);
    reasons.push(
      [
        `port ${port} is taken${pids.length ? "" : " (the listener's pid could not be read)"}.`,
        ...pids.map((pid) => `    pid ${pid} · ${describePid(pid)}`),
        `    Set KP_ME_LIVE_PORT to a free port, or stop that server.`,
      ].join("\n")
    );
  }
  if (!reasons.length) return;
  console.error(`[me-live] refusing to start: ${reasons.length === 1 ? "one thing is" : "two things are"} in the way.\n`);
  for (const reason of reasons) console.error(`  - ${reason}\n`);
  console.error("  Nothing was started and nothing was deleted. Stopping those processes is your call, not this script's.");
  process.exit(3);
}

// ── 3. a fresh database ──────────────────────────────────────────────────────────────────

function freshDb() {
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      rmSync(DB + suffix, { force: true, maxRetries: 3, retryDelay: 200 });
    } catch (error) {
      if (error?.code !== "EPERM" && error?.code !== "EBUSY") throw error;
      console.error(
        `[me-live] ${rel(DB + suffix)} is held open by another process (${error.code}) — likely a server from an earlier run that outlived it.\n` +
          "  Find and stop it (it serves the live DB, not yours), then run again. Nothing was started."
      );
      process.exit(1);
    }
  }
  say(`fresh database: ${rel(DB)}`);
}

// ── 4. the server, and taking it down on every exit path ─────────────────────────────────

let server = null;
let runner = null;
let tail = "";

function killTree(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  if (isWin) {
    // /T: Next's CLI, its start-server and every worker under them. Windows does not cascade.
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    return;
  }
  try {
    // Spawned detached: the whole process group, not just the CLI.
    process.kill(-child.pid, "SIGTERM");
  } catch {
    // The group is already gone; the direct child may still need the signal.
    try {
      child.kill("SIGTERM");
    } catch {
      /* already exited */
    }
  }
}

async function stopServer() {
  if (!server || server.exitCode !== null || server.signalCode !== null) return;
  const exited = new Promise((resolve) => server.once("exit", resolve));
  killTree(server);
  const gone = await Promise.race([exited.then(() => true), sleep(8_000).then(() => false)]);
  if (!gone && !isWin) {
    try {
      process.kill(-server.pid, "SIGKILL");
    } catch {
      /* it exited between the check and the signal */
    }
  }
}

function startServer(port) {
  const env = {
    ...process.env,
    KP_DB_PATH: DB,
    KP_JOBSEEKER: "1",
    KP_EMPTY: "1",
    KP_OPERATOR_PASSWORD: "",
    KP_OFFLINE: "0",
    DEV_INSPECT: "0",
    NEXT_TELEMETRY_DISABLED: "1",
  };
  if (process.env.KP_OFFLINE && process.env.KP_OFFLINE !== "0") say(`KP_OFFLINE=${process.env.KP_OFFLINE} is overridden for this server: a live scan must reach the network`);
  const log = createWriteStream(SERVER_LOG);
  // A log that cannot be written must not take the run down with it: the tail is kept in memory too.
  log.on("error", (error) => say(`the server log could not be written (${error.code ?? error.message}); its tail is still kept in memory`));
  server = spawn(process.execPath, [NEXT_BIN, "dev", "--port", String(port)], {
    cwd: ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: !isWin,
    windowsHide: true,
  });
  const keep = (chunk) => {
    tail = (tail + chunk.toString()).slice(-6000);
  };
  for (const stream of [server.stdout, server.stderr]) {
    stream.on("data", keep);
    stream.pipe(log, { end: false });
  }
  // `close`, not `exit`: it fires once stdout and stderr have drained, so no chunk is written
  // after the end.
  server.once("close", () => log.end());
  say(`dev server: pid ${server.pid} on http://localhost:${port} (log: ${rel(SERVER_LOG)})`);
}

async function waitForMe(port) {
  const url = `http://localhost:${port}/me`;
  const t0 = Date.now();
  let last = "no answer yet";
  let spoke = t0;
  while (Date.now() - t0 < BOOT_TIMEOUT_MS) {
    if (server.exitCode !== null || server.signalCode !== null) throw new Error(`the dev server exited (${server.exitCode ?? server.signalCode}) before /me answered`);
    try {
      // The first /me compiles the page and migrates the fresh database: minutes, cold.
      const res = await fetch(url, { signal: AbortSignal.timeout(240_000) });
      if (res.status === 200) {
        say(`/me answered 200 after ${Math.round((Date.now() - t0) / 1000)}s`);
        return;
      }
      last = `GET /me answered ${res.status}`;
    } catch (error) {
      last = error?.name === "TimeoutError" ? "GET /me timed out (still compiling?)" : "not listening yet";
    }
    if (Date.now() - spoke > 30_000) {
      spoke = Date.now();
      say(`waiting for /me… ${Math.round((Date.now() - t0) / 1000)}s (${last})`);
    }
    await sleep(2_000);
  }
  throw new Error(`/me did not answer 200 within ${BOOT_TIMEOUT_MS / 60_000} minutes (${last})`);
}

function runPlaywright(port, cv) {
  const cli = createRequire(import.meta.url).resolve("@playwright/test/cli");
  runner = spawn(process.execPath, [cli, "test", "jobseeker-live", "--project=chromium", "--reporter=list"], {
    cwd: ROOT,
    stdio: "inherit",
    // KP_E2E_BASE_URL drops playwright.config.ts's own webServer; the KP_ME_LIVE_* choices
    // ride along from this environment, the CV as the absolute path resolved above.
    env: { ...process.env, KP_E2E_BASE_URL: `http://localhost:${port}`, KP_ME_LIVE_CV: cv },
  });
  return new Promise((resolve) => runner.once("exit", (code, signal) => resolve(signal ? 1 : (code ?? 1))));
}

// Every exit path takes the server down: a normal end, an error, Ctrl-C, a task runner's
// SIGTERM. The last-resort `exit` hook is synchronous, which taskkill (Windows) and a
// process-group signal (POSIX) both are.
process.on("exit", () => killTree(server));
let interrupted = false;
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"]) {
  process.on(sig, () => {
    if (interrupted) return;
    interrupted = true;
    say(`${sig}: stopping the walk and the server`);
    const finish = async () => {
      killTree(runner);
      await stopServer();
      process.exit(130);
    };
    // Playwright gets a moment to finish on its own (it writes the report in afterAll).
    if (runner && runner.exitCode === null) {
      runner.once("exit", () => void finish());
      setTimeout(() => void finish(), 15_000).unref();
    } else void finish();
  });
}

async function main() {
  const cv = requireCv();
  const port = requirePort();
  if (!existsSync(NEXT_BIN)) {
    console.error("[me-live] node_modules/next is missing: run `npm ci` first. Nothing was started.");
    process.exit(1);
  }
  await refuseIfBusy(port);
  freshDb();
  startServer(port);
  try {
    await waitForMe(port);
  } catch (error) {
    console.error(`[me-live] ${error.message}\n--- the server's last output (${rel(SERVER_LOG)}) ---\n${tail}`);
    await stopServer();
    process.exit(1);
  }
  const code = await runPlaywright(port, cv);
  await stopServer();
  say(`report       ${rel(path.join(OUT, "report.md"))}`);
  say(`screenshots  ${rel(OUT)}/{light,dark}-{desktop,mobile}/, designer/, scan/`);
  say(`database     ${rel(DB)}, kept for inspection; the next run deletes it`);
  say(`server log   ${rel(SERVER_LOG)}`);
  say(`Playwright exited ${code}`);
  process.exit(code);
}

main().catch(async (error) => {
  console.error(`[me-live] ${error?.stack ?? error}`);
  killTree(runner);
  await stopServer();
  process.exit(1);
});
