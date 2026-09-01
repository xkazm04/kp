// P3 soak runner — ONE unattended night against the standing tenure, with an
// honest record of everything that went wrong (docs/development/app-master-soak.md).
//
// Called nightly by Windows Task Scheduler (soak-night.cmd). Design rules:
//
//   * A night that could not run is a RECORDED MISS, never a silent gap — the
//     taxonomy of misses (bridge down, kp boot failed, tick died) is half of
//     what the soak exists to measure (close-out §9: "bench-machine fragility").
//   * The runner never boots the Personas desktop app: it is the operator's
//     window, and the soak protocol keeps it running for the duration. Down ⇒
//     `bridge-down` miss. (Override deliberately with SOAK_BOOT_PERSONAS=1.)
//   * The kp bench server IS the runner's to boot and to stop — nothing this
//     script starts outlives it.
//   * Exit 0 always, unless the RUNNER itself is broken: a failed night is a
//     datapoint, and a scheduler that sees red every night teaches the operator
//     to ignore it.
//
// Appends one JSON line per night to bench/app-master/soak/log.jsonl.

import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SOAK_DIR = path.join(ROOT, "bench", "app-master", "soak");
const LOG = path.join(SOAK_DIR, "log.jsonl");
const KP_URL = process.env.SOAK_KP_URL ?? "http://localhost:3103";
const PERSONAS_URL = process.env.SOAK_PERSONAS_URL ?? "http://127.0.0.1:9420";
// A stable PER-USER location on every OS — never repo-relative: the doc warns
// that losing this file orphans the kp half of the tenure, and a fallback
// inside the checkout is one `git clean` from proving it (review round 3).
const DB =
  process.env.SOAK_KP_DB ??
  path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), ".local", "share"), "kp-bench", "kp-soak.sqlite");
const BACKLOG = process.env.SOAK_BACKLOG ?? path.join(ROOT, "uat", "value", "backlog-2026-08-31.json");
const TENURE = process.env.SOAK_TENURE ?? "kp-owner";
// The tenure FILE is the source of the roster handle — never a hardcoded id
// fragment, or a re-pointed SOAK_TENURE silently reads the wrong row and
// "memory unreported" conflates three different truths (review 2026-09-01).
const TENURE_FILE = existsSync(TENURE) ? TENURE : path.join(ROOT, "scripts", "app-master-bench", "tenures", `${TENURE}.json`);
let tenureHandles = null;
try {
  tenureHandles = JSON.parse(readFileSync(TENURE_FILE, "utf-8"));
} catch {
  /* recorded at the read site — the driver will fail loudly on its own */
}

/** Local calendar date (YYYY-MM-DD) — the soak's unit of time. `night` is a log
 *  index; DATE is what the gate counts and what gap backfill reasons over. */
const localDate = (d = new Date()) => d.toLocaleDateString("sv-SE");

const rec = {
  at: new Date().toISOString(),
  date: localDate(),
  night: null, // filled from the log length below
  ran: false,
  miss: null, // bridge-down | kp-boot-failed | driver-crashed
  exitCode: null,
  runDir: null,
  ideation: null,
  c1: null,
  dispatched: null,
  budgetSettledUsd: null,
  memory: null, // persona-memory tier counts from the roster — the longevity axis
  anomalies: [],
  ms: 0,
};
const t0 = Date.now();

function log(line) {
  process.stdout.write(line + "\n");
}

async function health(url, ms = 4000) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    const r = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    return { ok: r.ok || r.status === 503, json: await r.json().catch(() => null), status: r.status };
  } catch {
    return { ok: false, json: null, status: 0 };
  }
}

function finish() {
  rec.ms = Date.now() - t0;
  // ONE record, ONE verdict (round 11): a night whose record proves it RAN
  // cannot also be a miss — a driver timeout/exit observed AFTER a complete
  // record was written is a harness note, not the night's fate. The
  // observation survives in anomalies; the contradiction does not.
  if (rec.ran && rec.miss) {
    rec.anomalies.push(`the runner observed "${rec.miss}" AFTER the driver had written a complete record — the night ran; kept here as a harness note, not as the miss`);
    rec.miss = null;
  }
  // The classified-miss invariant, STRUCTURAL rather than per-path (rounds
  // 8+9): no record may say "did not run" without saying why — and when no
  // path recorded a reason, the honest class is IGNORANCE, not a named crash
  // that may never have happened. `unclassified` is itself a finding: the
  // record-keeping failed, and the weekly pass classifies it by hand.
  if (!rec.ran && !rec.miss) {
    rec.miss = "unclassified";
    rec.anomalies.push("no code path recorded WHY this night did not run — classify by hand and fix the runner path that stayed silent");
  }
  mkdirSync(SOAK_DIR, { recursive: true });
  const lines = existsSync(LOG) ? readFileSync(LOG, "utf-8").trim().split("\n").filter(Boolean) : [];
  let prior = lines.length;
  // Calendar-gap backfill (review round 7): a night the task never FIRED wrote
  // nothing, so the `machine` taxonomy class could never appear and 14 records
  // were indistinguishable from 14 nights spread over a month. Every calendar
  // day between the last record and today gets a retrospective `machine` miss —
  // the silent gap the first design rule forbids is now unrepresentable.
  try {
    const last = lines.length ? JSON.parse(lines.at(-1)) : null;
    const lastDate = last?.date ?? (last?.at ? localDate(new Date(last.at)) : null);
    if (lastDate) {
      const cursor = new Date(`${lastDate}T12:00:00`);
      for (;;) {
        cursor.setDate(cursor.getDate() + 1);
        const day = localDate(cursor);
        if (day >= rec.date) break;
        prior += 1;
        appendFileSync(
          LOG,
          JSON.stringify({
            at: new Date().toISOString(),
            date: day,
            night: prior,
            ran: false,
            miss: "machine",
            backfilled: true,
            anomalies: [
              "the scheduled task did not fire on this calendar day — host asleep, logged off, or powered down (the task is interactive-only, no wake-to-run); recorded retrospectively at the next firing",
            ],
            ms: 0,
          }) + "\n"
        );
      }
    }
  } catch {
    rec.anomalies.push("gap backfill failed — calendar continuity of the log is not guaranteed tonight");
  }
  rec.night = prior + 1;
  appendFileSync(LOG, JSON.stringify(rec) + "\n");
  log(`soak night ${rec.night}: ${rec.ran ? "ran" : `MISS (${rec.miss})`} · anomalies: ${rec.anomalies.length}`);
  process.exit(0);
}

// ── 1. Personas must already be up (the operator's window) ──────────────────
const personas = await health(`${PERSONAS_URL}/health`);
if (!(personas.json?.headlessBridge === true)) {
  rec.miss = "bridge-down";
  rec.anomalies.push(
    personas.status === 0
      ? "Personas is not running — the soak protocol keeps the app up; this night is a recorded miss"
      : `Personas answered but headlessBridge=${personas.json?.headlessBridge ?? "absent"} — launched without PERSONAS_HEADLESS_BRIDGE=1?`
  );
  finish();
}

// ── 2. kp bench server: boot if down, and remember whether WE booted it ─────
let kpChild = null;
let kp = await health(`${KP_URL}/api/health`);
if (!kp.ok) {
  log("kp bench server down — booting");
  kpChild = spawn(process.platform === "win32" ? "npx.cmd" : "npx", ["next", "dev", "--port", new URL(KP_URL).port], {
    cwd: ROOT,
    env: {
      ...process.env,
      KP_OFFLINE: "1",
      KP_SECRET: "bench",
      KP_EMPTY: "1",
      KP_DB_PATH: DB,
      // The parent of this checkout by default — never a hardcoded user path
      // (the repo is public; review 2026-09-01 finding 2).
      KP_APP_MASTER_REPO_ROOTS: process.env.SOAK_REPO_ROOTS ?? path.dirname(ROOT),
    },
    stdio: "ignore",
    detached: false,
    shell: process.platform === "win32",
  });
  const deadline = Date.now() + 240_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3000));
    kp = await health(`${KP_URL}/api/health`);
    if (kp.ok) break;
  }
  if (!kp.ok) {
    rec.miss = "kp-boot-failed";
    rec.anomalies.push(
      "the kp bench server did not answer health within 240s of boot — KP_EMPTY=1 puts it on the .next-empty build dir, so the likeliest holder of .next-empty/dev/lock is a running `npm run dev:empty`; a night while that server is up is a recorded miss (soak doc, Mechanics)"
    );
    if (kpChild) kpChild.kill();
    finish();
  }
}

// ── 3. One night through the real driver ────────────────────────────────────
// Snapshot BEFORE the spawn: a crashed driver must not let step 4 read
// YESTERDAY's newest run dir as tonight's record (review round 3 — it set
// ran:true, overwrote the miss and copied stale ideation/c1/budget wholesale).
const runsDir = path.join(ROOT, "bench", "app-master", "runs");
const priorRuns = new Set(existsSync(runsDir) ? readdirSync(runsDir) : []);

const driver = spawnSync(
  process.execPath,
  [
    path.join(ROOT, "scripts", "app-master-bench", "run.mjs"),
    "--scenario", "kp-c1-night",
    "--tenure", TENURE,
    "--nights", "1",
    "--backlog", BACKLOG,
    "--kp", KP_URL,
    "--report",
  ],
  { cwd: ROOT, env: { ...process.env, KP_ROOT: ROOT }, encoding: "utf-8", timeout: 2_400_000 }
);
rec.exitCode = driver.status;
if (driver.error) {
  // A timeout is not a crash (round 11): name what was observed.
  rec.miss = driver.error.code === "ETIMEDOUT" ? "driver-timeout" : "driver-crashed";
  rec.anomalies.push(`driver ${rec.miss === "driver-timeout" ? "exceeded its 40min ceiling" : `spawn error: ${driver.error.message}`}`);
}

// ── 4. Read the newest run record — the driver's truth, not the exit code ───
try {
  // Same guard as the pre-spawn snapshot: a fresh checkout has no runs dir yet,
  // and throwing here left miss:null — an UNCLASSIFIED miss, breaking the
  // file's first rule (review round 6).
  const newest = (existsSync(runsDir) ? readdirSync(runsDir) : [])
    .filter((d) => d.includes("kp-c1-night") && !priorRuns.has(d))
    .sort()
    .at(-1);
  if (newest) {
    rec.runDir = newest;
    const result = JSON.parse(readFileSync(path.join(runsDir, newest, "result.json"), "utf-8"));
    const n = result.nights?.[0] ?? {};
    rec.ran = n.tickOk === true;
    // A fresh run dir whose record carries no tickOk is a SHAPE problem, not a
    // crash (round 9): a partially written result.json or a driver format
    // change. Say that, or the structural fallback below would have to guess.
    // PRECEDENCE (round 10): a DIRECTLY OBSERVED cause — the runner watched the
    // spawn fail — is never overwritten by a record-derived guess. Both
    // record-derived classes below only fill an empty miss.
    if (n.tickOk === undefined && !rec.miss) {
      rec.miss = "record-unreadable";
      rec.anomalies.push(`the run record carries no tickOk (nights: ${Array.isArray(result.nights) ? result.nights.length : "absent"}) — a partially written result.json or a driver shape change; the night may even have run`);
    }
    rec.ideation = n.ideation ?? null;
    rec.dispatched = n.dispatched ?? null;
    rec.c1 = n.c1 ? { proposals: (n.c1.proposals ?? []).length, declines: (n.c1.declines ?? []).length, preTenure: n.c1.preTenure ?? null, undated: n.c1.undated ?? null } : null;
    rec.budgetSettledUsd = n.reading?.budgetSettledUsd ?? null;
    if (n.tickOk === false) {
      if (!rec.miss) rec.miss = "tick-died";
      rec.anomalies.push(`tick failed: ${n.tickError ?? "no error recorded"}`);
    }
    if (n.ideation?.ran === false) rec.anomalies.push(`ideation did not run: ${n.ideation?.blocked ?? "no reason"}`);
    if (n.ideation?.ran === true && n.ideation?.authored === 0) rec.anomalies.push("ideation ran and authored 0 — backpressure, dedup, or a drained repo; worth a look");
    if (typeof n.dispatched === "number" && n.dispatched > 0) rec.anomalies.push(`IDEATION NIGHT DISPATCHED ${n.dispatched} — the autopilot override failed (exam §6)`);
  } else {
    if (!rec.miss) rec.miss = "driver-crashed";
    rec.anomalies.push("the driver produced NO new run directory this night — nothing below is tonight's data, and nothing stale was read in its place");
  }
} catch (e) {
  if (!rec.miss) rec.miss = "driver-crashed";
  rec.anomalies.push(`could not read the run record: ${e.message}`);
}

// ── 5. Longevity axis: persona-memory tier counts off the roster ────────────
try {
  const roster = await health(`${KP_URL}/api/agents`);
  // Transport first: health() swallows errors into {ok:false}, so without this
  // check a 500 or an unreachable roster would fall into the !row branch and be
  // DIAGNOSED as a tenure/DB misconfiguration that never happened (review
  // 2026-09-01 finding 1 — the outer catch cannot see what health() ate).
  if (!roster.ok || !Array.isArray(roster.json?.agents)) {
    rec.anomalies.push(`roster unreadable (status ${roster.status}) — memory unmeasured tonight, and NO diagnosis beyond that`);
    throw { handled: true };
  }
  const wantedId = tenureHandles?.hiredAgentId ?? null;
  // The lookup gets its own guard (review round 7b): a payload-shape surprise
  // inside find/property access must not read as a transport problem — the same
  // conflation the three-way split below exists to prevent.
  let row = null;
  try {
    row = wantedId ? roster.json.agents.find((a) => a?.id === wantedId) : null;
  } catch (e) {
    rec.anomalies.push(`roster payload shape unexpected (${e.message}) — memory unmeasured tonight; NOT a transport problem, the roster answered`);
    throw { handled: true };
  }
  // Three DIFFERENT truths, recorded apart — collapsing them was the review's
  // blocking finding: no handle, no row, and a row whose reporter sent nothing.
  if (!wantedId) {
    rec.anomalies.push(`tenure file ${TENURE_FILE} unreadable or missing hiredAgentId — memory unmeasured AND unattributable tonight`);
  } else if (!row) {
    rec.anomalies.push(`roster has no row for ${wantedId} — wrong DB or wrong tenure, NOT a reporter gap; memory unmeasured tonight`);
  } else {
    // The last conflation in this block, split (round 12): a row with NO
    // appMaster block at all is a kp shape change or a non-App-master row —
    // NOT the Personas reporter gap the taxonomy treats as structural. Weeks
    // of chasing a Personas memory bug that does not exist is what this line
    // prevents.
    if (row.appMaster === undefined || row.appMaster === null) {
      rec.anomalies.push("the tenure's roster row carries no appMaster block — a kp roster shape change or a non-App-master row; NOT a reporter gap (memory unmeasured tonight)");
    } else {
      rec.memory = row.appMaster.memory ?? null;
      if (rec.memory === null) rec.anomalies.push("the tenure's own roster row carries no memory counts — the reporter sent none this window (longevity unmeasured tonight)");
    }
  }
} catch (e) {
  if (!e?.handled) rec.anomalies.push("could not read the roster for memory counts");
}

// ── 6. Leave nothing WE started running ─────────────────────────────────────
if (kpChild) {
  try {
    if (process.platform === "win32") {
      // kill() reaches only the cmd.exe wrapper under shell:true; the next dev
      // underneath survives HOLDING .next-empty/dev/lock (KP_EMPTY=1 → distDir
      // .next-empty, next.config.ts:82) and blocks the operator's `npm run
      // dev:empty` — not `npm run dev`, whose lock lives in .next (review
      // rounds 3+4). taskkill fells the tree.
      spawnSync("taskkill", ["/PID", String(kpChild.pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      kpChild.kill();
    }
  } catch {
    rec.anomalies.push("could not stop the kp bench server this runner started — a survivor may hold .next-empty/dev/lock and block `npm run dev:empty`");
  }
}

finish();
