#!/usr/bin/env node
// App-master mass-test driver — one scenario, end to end, unattended.
//
//   node scripts/app-master-bench/run.mjs --scenario kp-default \
//     --kp http://localhost:3101 --personas http://127.0.0.1:9420
//   node scripts/app-master-bench/run.mjs --all                    # every scenario, SERIALLY
//   node scripts/app-master-bench/run.mjs --all --stub-personas     # no Personas needed
//
// The loop it drives (kp routes on the left, Personas on the right):
//
//   preflight   GET /api/health                     GET  /health   (headlessBridge required)
//   pair        POST /api/agents/pair start+claim   POST /pair/request · GET /pair/claim
//   scan        POST /api/repo-scan → poll GET /api/repo-scan/[id]
//   intake      POST /api/intake {scanId} → POST /api/intake/[id]/dossier
//   dialog      9 × POST /api/intake/[id]/message   (the app_master slot script)
//   compose     POST /api/intake/[id]/compose-app-master
//   dispatch    POST /api/agents/dispatch {intakeId} →  POST /api/kp/persona-requests
//   activate    POST /api/agents/[id]/refresh until active
//   seed        POST /api/kp/test/seed-work  (the scenario's bench-protocol tasks)
//   nights      N × (tick overnight → SETTLE on reconcile polls → tick report
//                    → GET /api/agents, record the backbone)
//   probation   POST /api/kp/test/tick {phases:["probation"]} → record the decision
//
// Everything lands in bench/app-master/runs/<stamp>-<scenario>/ as journal.jsonl
// (append-only, written as it happens) plus result.json (the record report.mjs
// aggregates). A phase failure exits non-zero WITH THE PHASE NAMED; a failed
// expectation is a scenario FAIL with the delta printed, never a stack trace.
//
// TENURE MODE (docs/development/app-master-c1-exam.md §1). The unit of the
// bench is a TENURE, not a hire:
//
//   run.mjs --scenario kp-default --hire-only          → run the PREAMBLE once,
//                                                        write tenures/kp-owner.json, stop
//   run.mjs --scenario kp-c1-night --tenure kp-owner   → skip the preamble, run
//                                                        seed/nights/probation on those handles
//
// With neither flag the loop is exactly what it was. The preamble is ~14 calls
// and most of the wall clock and it re-tests the intake — a closed ring — every
// run; paying it once per repo is what it costs in real life, and it is what
// makes longevity (P3) testable at all: memory accumulates per persona across
// nights, and a persona that lives one run accumulates nothing.
//
// TWO PAIRINGS, ON PURPOSE. kp pairs with Personas to hire (its pk_ key is
// stored encrypted and never leaves the server — the driver cannot read it).
// The driver pairs SEPARATELY for its own `personas:test` key, because the test
// tick is a call the driver makes, not one kp makes. The driver's key is cached
// in the bench root so a second run does not re-pair.

import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  Journal,
  PhaseError,
  glyph,
  humanMs,
  kpClient,
  parseArgs,
  personasClient,
  poll,
  runStamp,
  sleep,
  verdictBanner,
} from "./lib.mjs";
import { dialogAnswers, listScenarioFiles, loadScenarioFile, resolveScenarioPath } from "./scenarios.mjs";
import {
  LIVE_AGENT_STATUSES,
  fleetAudit,
  loadTenureFile,
  orphanReport,
  readAllTenures,
  resolveTenurePath,
  tenureNameFor,
  tenureRepoLabel,
  writeTenureFile,
} from "./tenures.mjs";
import {
  evaluateExpectations,
  extractBackboneReading,
  extractNightLists,
  mergeReadings,
  phaseCounts,
  phaseEntry,
  readingFromRoster,
} from "./expectations.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const DEFAULT_BENCH_ROOT = path.join(REPO_ROOT, "bench", "app-master");

/** First value under `key` anywhere in a structure. Used for the probation
 *  decision, whose nesting inside the tick summary is Personas' to choose. */
function findFirst(node, key, guard = { n: 0 }) {
  if (guard.n++ > 5_000 || !node || typeof node !== "object") return undefined;
  if (!Array.isArray(node) && node[key] !== undefined && node[key] !== null) return node[key];
  for (const value of Object.values(node)) {
    const hit = findFirst(value, key, guard);
    if (hit !== undefined) return hit;
  }
  return undefined;
}

// ─── tenure mode: which phases run at all ───────────────────────────────────
//
// The preamble HIRES; everything after it exercises the holder. A tenure run
// has the hire already and skips the first half; `--hire-only` wants the hire
// and skips the second. Kept as a pure decision so the branch is provable
// without a server (run.test.mjs), the way `settleDispatch` is.

/** scan → activate: the one-time cost of hiring, per repo. */
export const PREAMBLE_PHASES = ["scan", "intake", "dialog", "compose", "dispatch", "activate"];
/** Everything that exercises an existing holder. */
export const TENURE_PHASES = ["seed", "nights", "probation"];

/**
 * Which phases this invocation skips, and why.
 *
 * `--hire-only` WINS over `--tenure`: with both, the tenure path is the
 * DESTINATION the fresh hire is written to, never a hire to resume. Anything
 * else would silently re-hire on top of a tenure that already exists.
 */
export function planPhases({ tenure = null, hireOnly = false } = {}) {
  if (hireOnly) {
    return {
      mode: "hire-only",
      skip: [...TENURE_PHASES],
      reason: "--hire-only stops after the hire: the preamble runs once and writes the tenure file",
    };
  }
  if (tenure) {
    return {
      mode: "tenure",
      skip: [...PREAMBLE_PHASES],
      reason: `--tenure ${tenure.name || tenure.hiredAgentId}: the hire already exists, so the preamble is not re-run`,
    };
  }
  return { mode: "fresh-hire", skip: [], reason: "no tenure and no --hire-only: the full loop, hire included" };
}

/**
 * The tenure record a completed preamble produces. Reads the COMPOSED spec
 * first and the scenario's dialog second: the composer clamps a rung and a
 * probation window the dialog only asked for, and a tenure file that recorded
 * the request rather than the grant would misdescribe the mandate the nights run
 * under. A field neither side carries stays null.
 */
export function tenureRecordFrom({ scenario, result, at = new Date().toISOString() }) {
  const highlights = result?.specHighlights ?? {};
  const rung = Number.isInteger(highlights.scopeRung) ? highlights.scopeRung : (scenario?.dialog?.scopeRung ?? null);
  const probationDays = Number.isInteger(highlights.probationDays)
    ? highlights.probationDays
    : (scenario?.dialog?.probationDays ?? null);
  return {
    repo: tenureRepoLabel(scenario),
    hiredAgentId: result?.hire?.hiredAgentId ?? null,
    personaId: result?.hire?.personaId ?? null,
    requestId: result?.hire?.requestId ?? null,
    hiredAt: at,
    rung,
    probationDays,
    scenario: scenario?.name ?? null,
    ...(result?.hire?.personaName ? { personaName: result.hire.personaName } : {}),
  };
}

// ─── the night: overnight → settle → report ─────────────────────────────────
//
// One tick per PHASE, not one tick for the lot, and that is the whole point.
// `overnight` DISPATCHES fleet sessions — live Claude Code sessions that go on
// to author branches asynchronously — and then returns. `reconcile` is what
// walks those branches into proposals and records their gate outcomes. Calling
// both in one tick reconciles a fleet that has not written anything yet: the
// 2026-08-25 sweep dispatched 3 and reconciled 173 ms later, saw
// `branchesSeen: 0`, and the delivery/gate lanes stayed structurally unmeasured
// for the rest of the run.
//
// So a night now: tick `overnight`, and if it dispatched anything, SETTLE —
// re-tick `reconcile` on a poll interval until the dispatch is accounted for,
// the counts stop moving, or the settle budget runs out — and only then tick
// `report`, which is what pushes the rollup kp scores the roster row from.

/** How many sessions an overnight tick says it dispatched. `null` = it did not
 *  say, which is NOT zero: a driver that read an absence as zero would skip the
 *  settle wait exactly when the summary shape moved. */
export function dispatchedCount(summary) {
  const counts = phaseCounts(summary, "overnight");
  if (typeof counts?.dispatched === "number") return counts.dispatched;
  const entry = phaseEntry(summary, "overnight");
  if (typeof entry?.dispatchedCount === "number") return entry.dispatchedCount;
  return null;
}

/**
 * How much of a dispatch ONE reconcile answer accounts for: the branches it
 * saw, or the proposals it newly recorded plus the ones it gated. `null` when
 * the answer carried none of the three — an unreported reconcile is not a
 * reconcile that found nothing.
 */
export function accountedBy(counts) {
  if (!counts || typeof counts !== "object") return null;
  const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const seen = num(counts.branchesSeen);
  const recorded = num(counts.newlyRecorded);
  const gated = num(counts.gated);
  if (seen === null && recorded === null && gated === null) return null;
  return Math.max(seen ?? 0, (recorded ?? 0) + (gated ?? 0));
}

/** Merge the per-phase tick summaries of one night into the single summary the
 *  night record carries. Both wire shapes survive: an array of phase results
 *  (the real bridge, §13.6) concatenates, an object map (the stub) merges, and
 *  a run that somehow saw both keeps every entry. */
export function mergeTickSummaries(summaries) {
  const kept = (summaries ?? []).filter((s) => s && typeof s === "object" && !Array.isArray(s));
  if (kept.length === 0) return null;
  const merged = {};
  let asArray = null;
  let asObject = null;
  for (const summary of kept) {
    for (const [key, value] of Object.entries(summary)) {
      if (key !== "phases") merged[key] = value;
    }
    const phases = summary.phases;
    if (Array.isArray(phases)) asArray = (asArray ?? []).concat(phases);
    else if (phases && typeof phases === "object") asObject = { ...(asObject ?? {}), ...phases };
  }
  if (asArray && asObject) {
    merged.phases = asArray.concat(Object.entries(asObject).map(([phase, body]) => ({ phase, ...body })));
  } else if (asArray) merged.phases = asArray;
  else if (asObject) merged.phases = asObject;
  return merged;
}

/**
 * Wait out the dispatched fleet, one `reconcile` tick per poll.
 *
 * Stops on the FIRST of: the dispatch is accounted for; the counts have not
 * moved across three consecutive polls (the fleet failed, or authored nothing);
 * the settle budget elapsed. Every poll is journalled as it happens, so a night
 * that never settled is readable evidence rather than a silent wait.
 */
export async function settleDispatch({
  tickReconcile,
  journal,
  night,
  dispatched,
  pollMs,
  timeoutMs,
  now = () => Date.now(),
  wait = sleep,
  stallPolls = 3,
  // Confirms the dispatch produced a COMMITTED proposal (the roster's
  // tenure-scoped proposalsOpened, which requires commits since P6o). Sweep
  // #25: 16 stale branches satisfied the raw \"accounted\" arithmetic three
  // minutes into a night whose worker was still authoring — counts alone
  // cannot distinguish old branches from this dispatch's work. When given,
  // \"accounted\" is only a milestone; the loop stops on confirmation, on the
  // flat guard (worker authored nothing — a legitimate outcome), or on the
  // budget.
  confirmOpened = null,
}) {
  const startedAt = now();
  const record = {
    dispatched,
    pollMs,
    timeoutMs,
    polls: [],
    accounted: null,
    stoppedBy: null,
    ms: 0,
    lastSummary: null,
  };
  if (!(typeof dispatched === "number" && dispatched > 0)) {
    record.stoppedBy = dispatched === null ? "dispatch-unreported" : "nothing-dispatched";
    journal?.write("settle-skip", {
      night,
      dispatched,
      reason:
        dispatched === null
          ? "the overnight tick reported no dispatch count — nothing to wait for, and nothing to claim was waited for"
          : "overnight dispatched nothing: no fleet session is authoring a branch tonight",
    });
    return record;
  }

  const totals = { branchesSeen: 0, newlyRecorded: 0, gated: 0 };
  let accounted = 0;
  let flat = 0;
  for (let pollNo = 1; ; pollNo++) {
    const answer = await tickReconcile();
    const summary = answer?.summary ?? null;
    if (summary) record.lastSummary = summary;
    const counts = phaseCounts(summary, "reconcile");
    const step = accountedBy(counts);
    if (counts) {
      for (const key of Object.keys(totals)) {
        if (typeof counts[key] === "number" && Number.isFinite(counts[key])) totals[key] += counts[key];
      }
    }
    const before = accounted;
    accounted = Math.max(totals.branchesSeen, totals.newlyRecorded + totals.gated);
    const entry = {
      night,
      poll: pollNo,
      atMs: now() - startedAt,
      ok: answer?.ok !== false,
      counts: counts ?? null,
      step,
      accounted,
      dispatched,
      ...(answer?.error ? { error: answer.error } : {}),
    };
    record.polls.push(entry);
    journal?.write("settle-poll", entry);

    let opened = null;
    if (confirmOpened && accounted >= dispatched) {
      opened = await confirmOpened().catch(() => null);
      entry.opened = opened;
      journal?.write("settle-confirm", { night, poll: pollNo, opened, dispatched });
      if (typeof opened === "number" && opened >= 1) {
        record.stoppedBy = "opened-confirmed";
        record.opened = opened;
        break;
      }
    } else if (accounted >= dispatched) {
      record.stoppedBy = "accounted";
      break;
    }
    const confirmMoved = typeof opened === "number" && opened !== record.lastOpened;
    if (typeof opened === "number") record.lastOpened = opened;
    // Once the raw arithmetic is satisfied and a confirmer is in play, stale
    // branches keep the counts "growing" forever — only the confirmed reading
    // counts as progress from that point on.
    const progressed = confirmOpened && accounted >= dispatched ? confirmMoved : accounted > before || confirmMoved;
    flat = progressed ? 0 : flat + 1;
    // While a confirmer is active, the wait IS the point: a real authoring
    // session runs 5–15+ min, and 3 flat polls (~4.5 min) declared a healthy
    // worker stalled (sweep #26, night 1, polls 2–5). With confirm in play the
    // flat leash stretches ×4 (≈18 min at the default poll); the settle budget
    // stays the hard bound.
    const flatLimit = confirmOpened && accounted >= dispatched ? stallPolls * 4 : stallPolls;
    if (flat >= flatLimit) {
      record.stoppedBy = "stalled";
      break;
    }
    const elapsed = now() - startedAt;
    if (elapsed >= timeoutMs || elapsed + pollMs > timeoutMs) {
      record.stoppedBy = "timeout";
      break;
    }
    await wait(pollMs);
  }
  record.accounted = accounted;
  record.ms = now() - startedAt;
  return record;
}

/** Status → the probation decision it implies, when the reporter named none.
 *  Lossy by construction (an `onboarding` row could be an extension or an
 *  un-started hire), so the result records that it was DERIVED. */
const STATUS_TO_DECISION = { active: "activated", onboarding: "extended", retired: "retired", rejected: "retired" };

// ─── the build, and its one retry ───────────────────────────────────────────
//
// Personas' one-shot hire build is NONDETERMINISTIC and fails a meaningful
// fraction of hires for reasons that have nothing to do with the role under
// test — "promotion held: tools never called" (since fixed structurally) and a
// design pass writing a literal `{{param.daily_audit_hour}}` into a cron were
// both read off live sweeps. Each one used to cost a whole scenario: the
// `activate` phase fails fast on the terminal `failed` status (ladder
// `onboarding → failed`) and the run ends there.
//
// A bench whose job is to measure the ROLE must MEASURE that flake rate instead
// of being defeated by it. So a failed build is re-dispatched ONCE against the
// same intake and the same composed spec, and every attempt is recorded —
// `hire.buildAttempts` plus one `hire.buildFailures[]` entry per dead build, so
// the sweep reports build reliability rather than hiding it inside a pass.
//
// The retry is scoped as tightly as honesty allows:
//
//   * only a TERMINAL `failed`. `rejected` and `retired` are DECISIONS about
//     the hire; re-dispatching over one would be the driver overruling the very
//     thing it is measuring.
//   * NEVER a timeout. A timed-out activate leaves an orphan build session
//     running (the bridge has no cancel endpoint), so a second dispatch would
//     race two live builds for one intake and burn two subscription seats to
//     measure one. A timeout throws straight through this loop, orphan warning
//     and all.
export const MAX_BUILD_ATTEMPTS = 2;

/**
 * What Personas says killed a build, if it says anything at all.
 *
 * `GET /api/kp/persona-requests/{id}` answers the management envelope
 * (`{success, data}`) and carries the build's own state in `buildPhase` — a
 * string on some builds, an object (`{phase, status, reason}`) on others. An
 * ABSENT reading stays `null`: a retry that invented a reason would be worse
 * than one that admits it has none.
 */
export function buildFailureReason(payload) {
  const data = payload?.data ?? payload ?? null;
  if (!data || typeof data !== "object") return null;
  const text = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const phase = data.buildPhase;
  if (text(phase)) return text(phase);
  if (phase && typeof phase === "object" && !Array.isArray(phase)) {
    const named = text(phase.reason) ?? text(phase.error) ?? text(phase.detail);
    if (named) return text(phase.phase) ? `${text(phase.phase)}: ${named}` : named;
    if (text(phase.phase)) return `build phase ${text(phase.phase)}${text(phase.status) ? ` (${text(phase.status)})` : ""}`;
  }
  return text(data.failureReason) ?? text(data.error) ?? text(data.statusReason) ?? null;
}

/**
 * Run the hire's build, retrying a FAILED one once.
 *
 * `activate(attempt)` resolves `{ok:true, row, ladder}` when the hire reached
 * `active`, `{ok:false, terminal, ladder, requestId, hiredAgentId}` when it
 * reached a terminal non-active status — and THROWS when it timed out, which is
 * the case that must not be retried (see above). `dispatch(attempt)` re-runs
 * `POST /api/agents/dispatch` for the same intake.
 *
 * `failures` is the caller's accumulator ON PURPOSE: a throw from a later
 * attempt (a timeout on the retry, say) must not lose the record of the failure
 * that caused the retry in the first place.
 */
/** A build that dies terminally within this window never really ran — a
 *  session-limit refusal, not a design failure. Sweep #30: four scenarios'
 *  builds died in ~25s BOTH attempts during a limit window and the sweep
 *  burned itself out in two minutes. */
export const INSTANT_FAILURE_MS = 90_000;
/** How long to wait out a suspected limit window before the extra attempt. */
export const LIMIT_WINDOW_WAIT_MS = 20 * 60_000;

export async function buildWithRetry({
  activate,
  dispatch,
  journal = null,
  reasonFor = async () => null,
  maxAttempts = MAX_BUILD_ATTEMPTS,
  failures = [],
  wait = sleep,
  limitWaitMs = LIMIT_WINDOW_WAIT_MS,
  instantFailureMs = INSTANT_FAILURE_MS,
}) {
  let limitWaitSpent = false;
  for (let attempt = 1; ; attempt++) {
    const startedAt = Date.now();
    const outcome = await activate(attempt);
    const buildMs = Date.now() - startedAt;
    if (outcome?.ok) {
      return { ok: true, attempts: attempt, failures, row: outcome.row ?? null, ladder: outcome.ladder ?? [] };
    }
    const requestId = outcome?.requestId ?? null;
    const reason = (await reasonFor(requestId, attempt)) ?? null;
    failures.push({
      attempt,
      requestId,
      hiredAgentId: outcome?.hiredAgentId ?? null,
      terminal: outcome?.terminal ?? null,
      ladder: outcome?.ladder ?? [],
      reason,
      buildMs,
    });
    const instant = outcome?.terminal === "failed" && buildMs < instantFailureMs;
    if (outcome?.terminal !== "failed") {
      return { ok: false, attempts: attempt, failures, terminal: outcome?.terminal ?? null, ladder: outcome?.ladder ?? [] };
    }
    if (attempt >= maxAttempts) {
      // Both regular attempts spent. An INSTANT final failure earns one
      // wait-it-out attempt — once per scenario, never for a real build death.
      if (instant && !limitWaitSpent) {
        limitWaitSpent = true;
        journal?.write("limit-window-wait", { waitMs: limitWaitMs, attempt: attempt + 1, previousRequestId: requestId });
        await wait(limitWaitMs);
        journal?.write("build-retry", { attempt: attempt + 1, previousRequestId: requestId, reason: "instant terminal failure — suspected session-limit window, waited it out" });
        await dispatch(attempt + 1);
        continue;
      }
      return { ok: false, attempts: attempt, failures, terminal: outcome?.terminal ?? null, ladder: outcome?.ladder ?? [] };
    }
    journal?.write("build-retry", { attempt: attempt + 1, previousRequestId: requestId, reason });
    await dispatch(attempt + 1);
  }
}

// ─── phase helpers ──────────────────────────────────────────────────────────

async function phase(result, journal, name, body) {
  const started = Date.now();
  journal.write("phase-start", { phase: name });
  try {
    const value = await body();
    const entry = { phase: name, ok: true, ms: Date.now() - started };
    result.phases.push(entry);
    journal.write("phase-ok", entry);
    return value;
  } catch (error) {
    const entry = {
      phase: name,
      ok: false,
      ms: Date.now() - started,
      error: String(error?.message || error),
      ...(error?.detail ? { detail: error.detail } : {}),
    };
    result.phases.push(entry);
    result.errors.push(entry);
    journal.write("phase-fail", entry);
    // The PHASE is the name of this block, always — a PhaseError minted deeper
    // (by `must()`, naming a route) keeps its message and detail but is
    // re-stamped, so `failedPhase` is a phase and the exit line names one.
    throw new PhaseError(name, String(error?.message || error), error?.detail);
  }
}

/** A kp call that must succeed, or the phase fails naming the route + status. */
function must(name, res, hint = "") {
  if (res.ok) return res.json ?? {};
  const detail = res.error ? res.error : `${res.status} ${JSON.stringify(res.json ?? res.text).slice(0, 300)}`;
  throw new PhaseError(name, `${name}: ${detail}${hint ? ` — ${hint}` : ""}`, { status: res.status, body: res.json });
}

// ─── the run ────────────────────────────────────────────────────────────────

async function runScenario(scenario, opts) {
  const stamp = runStamp();
  const runDir = path.join(opts.benchRoot, "runs", `${stamp}-${scenario.name}`);
  const journal = new Journal(runDir);
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const runTag = Date.now().toString(36);

  let throttledMs = 0;
  const kp = kpClient(opts.kpUrl, {
    throttleWaitMs: opts.throttleWaitMs,
    onThrottle: ({ route, attempt, waitMs }) => {
      throttledMs += waitMs;
      journal.write("throttled", { route, attempt, waitMs, note: "kp rate-limited this route; waiting out its fixed window" });
    },
  });
  // ── pairing, and re-pairing ───────────────────────────────────────────────
  //
  // BOTH keys in this loop EXPIRE. Personas' headless auto-pair mints 24-hour
  // keys, and sweep #15 (2026-08-25) ran across that boundary: the driver's
  // cached key answered `401 invalid api key` on `POST /api/kp/test/seed-work`,
  // and kp's own bridge key answered 401 too, surfacing as
  // `502 Personas responded 401` on `POST /api/agents/dispatch`. Neither is a
  // broken server and neither should end a 40-minute run — but neither may be
  // papered over either, so each repair is JOURNALLED with the route that
  // exposed it, and each is attempted exactly once per call.
  let repairedDriverKeys = 0;
  let repairedKpKeys = 0;

  /** Mint a fresh `personas:test` key for the driver and cache it. */
  const pairDriverKey = async () => {
    const nonce = randomBytes(24).toString("hex");
    const asked = await personas.post(
      "/pair/request",
      { nonce, scopes: ["personas:read", "personas:test"], client: { name: "kp app-master bench", kind: "cli" } },
      { timeoutMs: 30_000 }
    );
    if (!asked.ok) throw new PhaseError("pair", `POST /pair/request refused the driver: ${asked.status} ${asked.text.slice(0, 200)}`);
    const claimed = await poll(
      async () => {
        const res = await personas.get(`/pair/claim?nonce=${encodeURIComponent(nonce)}`, { timeoutMs: 30_000 });
        const k = res.json?.token ?? res.json?.apiKey ?? res.json?.key;
        return typeof k === "string" && k ? k : null;
      },
      { maxMs: 120_000, everyMs: 2_000, label: "the driver's pairing claim (headless mode auto-approves)" }
    );
    personas.setKey(claimed);
    if (opts.keyCacheFile) {
      mkdirSync(path.dirname(opts.keyCacheFile), { recursive: true });
      writeFileSync(
        opts.keyCacheFile,
        `${JSON.stringify({ baseUrl: personas.base, apiKey: claimed, pairedAt: new Date().toISOString() }, null, 2)}\n`,
        "utf8"
      );
    }
    return claimed;
  };

  /** Re-pair KP's own bridge: disconnect the dead key, then run the pairing
   *  handshake again. `DELETE /api/agents/bridge` clears the stored pk_ while
   *  keeping the base URL — an env-configured bridge refuses (409), which is
   *  correct and is reported rather than worked around. */
  const pairKpBridge = async () => {
    const started = must(
      "POST /api/agents/pair (start)",
      await kp.post("/api/agents/pair", { phase: "start", baseUrl: personas.base }),
      "kp needs KP_SECRET (or KP_ATS_SECRET_KEY) set to store the pk_ key encrypted"
    );
    const nonce = started.nonce;
    if (!nonce) throw new PhaseError("pair", "kp's pairing start returned no nonce");
    await poll(
      async () => {
        const res = await kp.post("/api/agents/pair", { phase: "claim", nonce });
        if (!res.ok) throw new PhaseError("pair", `kp's pairing claim failed: ${res.status} ${JSON.stringify(res.json)}`);
        return res.json?.paired === true;
      },
      { maxMs: 120_000, everyMs: 2_000, label: "kp's pairing claim" }
    );
  };

  /** The 401 hook the Personas client calls: discard the cached key, re-pair,
   *  and let the client retry the call once. Returns false when re-pairing
   *  failed, so the original 401 reaches the caller as data. */
  const repairDriverKey = async ({ route, status }) => {
    if (repairedDriverKeys >= 3) return false;
    repairedDriverKeys += 1;
    const stalePrefix = personas.key ? personas.key.slice(0, 6) : null;
    personas.setKey(null);
    if (opts.keyCacheFile) {
      try {
        rmSync(opts.keyCacheFile, { force: true });
      } catch {
        /* a cache we cannot delete is one the re-pair overwrites anyway */
      }
    }
    try {
      const key = await pairDriverKey();
      journal.write("repaired-driver-key", {
        route,
        status,
        stalePrefix,
        keyPrefix: key.slice(0, 6),
        attempt: repairedDriverKeys,
        note: "the driver's cached personas:test key was rejected (headless auto-pair keys live 24h) — discarded the cache, re-paired, retrying the call once",
      });
      result.warnings.push(
        `the driver's Personas key had expired (401 on ${route}) — re-paired mid-run and retried; the cached key at ${opts.keyCacheFile ?? "(uncached)"} was replaced.`
      );
      return true;
    } catch (error) {
      journal.write("repair-driver-key-failed", { route, status, error: String(error?.message || error) });
      return false;
    }
  };
  const personas = personasClient(opts.personasUrl, opts.personasKey ?? null, { onUnauthorized: repairDriverKey });

  /** Does this kp answer read as "Personas rejected OUR key"? kp maps an
   *  upstream 401 to `AGENT_BRIDGE_KEY_INVALID` (bridge-client.ts) and still
   *  answers 502; an older build only says it in the message. Both are read. */
  const readsAsBridgeKeyFailure = (res) => {
    const body = res?.json ?? {};
    if (body.code === "AGENT_BRIDGE_KEY_INVALID") return true;
    const text = `${body.error ?? ""} ${body.reason ?? ""} ${res?.text ?? ""}`;
    return /Personas responded 401|invalid api key|pairing key has expired/i.test(text);
  };

  /** Re-pair KP's bridge after Personas rejected its stored key. */
  const repairKpKey = async (route, res) => {
    if (repairedKpKeys >= 2) return false;
    repairedKpKeys += 1;
    const disconnect = await kp.del("/api/agents/bridge");
    if (!disconnect.ok && disconnect.status !== 409) {
      journal.write("repair-kp-key-failed", { route, step: "disconnect", status: disconnect.status });
      return false;
    }
    if (disconnect.status === 409) {
      // An env-configured bridge (PERSONAS_BRIDGE_URL/KEY) cannot be re-paired
      // through the API — env beats the stored row by design. Say so; do not
      // pretend the retry will help.
      journal.write("repair-kp-key-failed", {
        route,
        step: "disconnect",
        status: 409,
        note: "kp's bridge is configured from the environment (PERSONAS_BRIDGE_URL/KEY) — the expired key has to be replaced in the deployment env, not by re-pairing",
      });
      return false;
    }
    try {
      await pairKpBridge();
    } catch (error) {
      journal.write("repair-kp-key-failed", { route, step: "pair", error: String(error?.message || error) });
      return false;
    }
    journal.write("repaired-kp-key", {
      route,
      status: res?.status ?? null,
      code: res?.json?.code ?? null,
      attempt: repairedKpKeys,
      note: "Personas rejected kp's stored pk_ key (headless auto-pair keys live 24h) — disconnected the bridge, re-paired kp, retrying the call once",
    });
    result.warnings.push(
      `kp's Personas bridge key had expired (${route} → ${res?.status ?? "?"}) — kp was re-paired mid-run and the call retried.`
    );
    return true;
  };

  // What this invocation is: a fresh hire, a run against an existing tenure, or
  // a preamble whose only product is the tenure file (c1-exam §1).
  const tenure = opts.tenure ?? null;
  const plan = planPhases({ tenure, hireOnly: !!opts.hireOnly });

  const result = {
    schemaVersion: 1,
    scenario: { ...scenario, file: scenario.file ?? null },
    runDir,
    startedAt,
    runMode: plan.mode,
    tenure: tenure ? { ...tenure } : null,
    tenureWritten: null,
    skippedPhases: [],
    finishedAt: null,
    wallMs: null,
    mode: scenario.mode,
    kp: { baseUrl: kp.base, health: null },
    fleet: null,
    personas: { baseUrl: personas.base, health: null, stub: !!opts.stub },
    // The operator's own ranked backlog (--backlog), which `rankVsBacklog`
    // grades the night's proposal list against. PRE-SCORED elsewhere: turning a
    // title into a value is `/value-ledger`'s job, not the driver's.
    backlog: opts.backlog ?? null,
    scan: null,
    intakeId: null,
    dialog: [],
    spec: null,
    specHighlights: null,
    populationFit: null,
    hire: null,
    seed: null,
    nights: [],
    probation: null,
    costReportedUsd: null,
    unmeasured: [],
    phases: [],
    expectations: [],
    errors: [],
    warnings: [],
    ok: false,
    failedPhase: null,
  };

  journal.write("run-start", {
    scenario: scenario.name,
    kp: kp.base,
    personas: personas.base,
    mode: scenario.mode,
    runMode: plan.mode,
    ...(tenure ? { tenure: tenure.file ?? tenure.name ?? null } : {}),
  });

  /** THIS run's row on kp's roster. Declared here rather than beside `activate`
   *  because a tenure run has no activate — it resolves the same row from a
   *  handle it was given. Reads `result.hire` at call time, so the order of
   *  declaration and assignment does not matter. */
  const rosterRow = async () => {
    const roster = must("GET /api/agents", await kp.get("/api/agents"));
    return (roster.agents ?? []).find((a) => a.id === result.hire?.hiredAgentId) ?? null;
  };

  /** A phase this invocation does not run. Written down — a silently skipped
   *  phase is how "nothing measured this" stops being visible. */
  const skipPhase = (name, reason) => {
    result.skippedPhases.push({ phase: name, reason });
    journal.write("phase-skipped", { phase: name, reason });
  };

  try {
    // ── preflight ───────────────────────────────────────────────────────────
    await phase(result, journal, "preflight", async () => {
      const health = await kp.get("/api/health", undefined, { timeoutMs: 60_000 });
      if (health.status === 0) {
        throw new PhaseError("preflight", `kp is not answering at ${kp.base}: ${health.error}`);
      }
      result.kp.health = health.json;
      // A 503 is NOT fatal: an empty-DB bench server degrades on "job catalog is
      // empty", which has nothing to do with this loop. An unopenable DB is.
      if (health.json?.db !== "ok") {
        throw new PhaseError("preflight", `kp reports db: ${JSON.stringify(health.json?.db)} — the bench needs a working database`);
      }
      if (health.status === 503) {
        result.warnings.push(`kp /api/health is degraded: ${(health.json?.degradedReasons ?? []).join("; ") || "no reason given"}`);
      }
      if (scenario.mode === "keyless" && health.json?.engines?.gemini) {
        // Not a refusal: KP_OFFLINE seals the engines regardless of what keys sit
        // in the env. The real keyless gate is the per-turn `source` assertion
        // below — this is the disclosure that the env is not itself keyless.
        result.warnings.push(
          "a Gemini key is configured on the kp host — keyless honesty rests on KP_OFFLINE=1 and is asserted per dialog turn"
        );
      }

      const ph = await personas.get("/health", { timeoutMs: 30_000 });
      if (ph.status === 0) {
        throw new PhaseError("preflight", `Personas is not answering at ${personas.base}: ${ph.error}`);
      }
      result.personas.health = ph.json;
      if (ph.json?.status !== "ok" || ph.json?.management !== true) {
        throw new PhaseError("preflight", `Personas answered ${JSON.stringify(ph.json)} — the management route table is not live`);
      }
      if (ph.json?.headlessBridge !== true) {
        throw new PhaseError(
          "preflight",
          "Personas is not in headless bridge mode (health.headlessBridge is not true) — this driver cannot approve a hire by hand. Start it with PERSONAS_HEADLESS_BRIDGE=1."
        );
      }
      // ── the fleet audit (c1-exam §4) ─────────────────────────────────────
      //
      // Every LIVE hired agent kp holds, against the tenure files on disk. An
      // agent no tenure names is an ORPHAN — nothing will ever retire it, and
      // 31 sweeps of exactly that left 100+ personas behind. Listing it here,
      // with its age, is what turns that into a red preflight the next time it
      // starts happening instead of a discovery six weeks later.
      //
      // The audit itself never fails a run: a bench that refuses to start
      // because of yesterday's mess is a bench nobody runs. `--strict` is the
      // opt-in that blocks, and it is what CI (and a P2/P3 session) should use.
      const roster = await kp.get("/api/agents");
      const { tenures: known, problems } = readAllTenures();
      if (!roster.ok) {
        result.unmeasured.push(
          `fleet audit: GET /api/agents answered ${roster.status || "nothing"} — the orphan count is unknown, which is not the same as zero`
        );
        result.fleet = { audited: false, reason: `GET /api/agents → ${roster.status || "no answer"}`, orphans: [] };
      } else {
        const audit = fleetAudit(roster.json?.agents ?? [], known, { now: Date.now() });
        result.fleet = {
          audited: true,
          ...audit,
          tenureFiles: known.map((t) => t.file ?? t.name ?? null),
          tenureProblems: problems,
        };
        journal.write("fleet-audit", {
          rostered: audit.rostered,
          live: audit.live,
          tenures: audit.tenures,
          orphans: audit.orphans.length,
        });
        for (const problem of problems) {
          result.warnings.push(`fleet audit: ${path.basename(problem.file)} is not a readable tenure file — ${problem.error}`);
        }
        if (audit.orphans.length > 0) {
          const line = orphanReport(audit);
          result.warnings.push(line);
          process.stderr.write(`  ! ${line}\n`);
          for (const orphan of audit.orphans) {
            process.stderr.write(`      orphan ${orphan.id} · ${orphan.status} · ${orphan.age} old · persona ${orphan.personaId ?? "–"}\n`);
          }
          if (opts.strict) {
            throw new PhaseError(
              "preflight",
              `${line}. Retire them (--teardown on the run that hired them) or record them in scripts/app-master-bench/tenures/ — --strict refuses to start a run on top of an orphan fleet.`,
              { orphans: audit.orphans }
            );
          }
        }
      }

      journal.write("preflight-ok", { kp: result.kp.health?.ok, personas: ph.json, orphans: result.fleet?.orphans?.length ?? null });
    });

    // ── pair ────────────────────────────────────────────────────────────────
    await phase(result, journal, "pair", async () => {
      // (1) the DRIVER's own key, for POST /api/kp/test/tick.
      let key = personas.key;
      if (key) {
        const probe = await personas.get("/api/kp/connector-catalog", { timeoutMs: 30_000 });
        if (!probe.ok) {
          journal.write("pair-key-stale", { status: probe.status });
          key = null;
        }
      }
      if (!key) {
        key = await pairDriverKey();
        journal.write("pair-driver", { keyPrefix: key.slice(0, 6), cached: !!opts.keyCacheFile });
      } else {
        journal.write("pair-driver", { keyPrefix: key.slice(0, 6), reused: true });
      }

      // (2) kp's OWN pairing. Its key is stored encrypted server-side; the driver
      //     can only observe whether one exists and against which base URL.
      const bridge = must("GET /api/agents/bridge", await kp.get("/api/agents/bridge"));
      const already = bridge.bridge?.paired && bridge.bridge?.baseUrl?.replace(/\/$/, "") === personas.base;
      if (already) {
        journal.write("pair-kp", { reused: true, baseUrl: bridge.bridge.baseUrl });
        return;
      }
      await pairKpBridge();
      journal.write("pair-kp", { paired: true, baseUrl: personas.base });
    });

    // ── tenure: the hire this run inherits ──────────────────────────────────
    //
    // The whole preamble collapses to one question: do these handles still
    // resolve to a live hire on THIS kp? A tenure file that names a row from
    // another machine's DB (or a hire that has since been retired) must fail
    // here, named — not at the first tick, as an unmeasured night.
    if (plan.mode === "tenure") {
      for (const name of PREAMBLE_PHASES) skipPhase(name, plan.reason);
      await phase(result, journal, "tenure", async () => {
        result.hire = {
          hiredAgentId: tenure.hiredAgentId,
          requestId: tenure.requestId ?? null,
          personaId: tenure.personaId,
          personaName: tenure.personaName ?? null,
          status: null,
          fromTenure: tenure.file ?? tenure.name ?? null,
          hiredAt: tenure.hiredAt ?? null,
          buildAttempts: 0,
          buildFailures: [],
        };
        const row = await rosterRow();
        if (!row) {
          throw new PhaseError(
            "tenure",
            `the tenure names hired agent ${tenure.hiredAgentId}, which is not on kp's roster at ${kp.base} — wrong KP_DB_PATH, or the tenure was written against another install`,
            { hiredAgentId: tenure.hiredAgentId }
          );
        }
        if (!LIVE_AGENT_STATUSES.includes(row.status)) {
          throw new PhaseError(
            "tenure",
            `the tenure's hire reads status \`${row.status}\` on kp's roster — a finished hire has no nights left to run. Hire a new tenure (--hire-only) rather than ticking a dead one.`,
            { hiredAgentId: tenure.hiredAgentId, status: row.status }
          );
        }
        result.hire.status = row.status;
        result.hire.personaName = row.personaName ?? result.hire.personaName;
        // Personas is the side that owns the persona id; a tenure file whose id
        // no longer matches the roster row is a handle that drifted, and the
        // ticks would be scoped to the wrong project. Report it, do not "fix" it.
        if (row.personaId && tenure.personaId && row.personaId !== tenure.personaId) {
          result.warnings.push(
            `tenure drift: the tenure file says personaId ${tenure.personaId}, kp's roster row says ${row.personaId} — the ticks below are scoped to the FILE's id, which is what the last run's nights used.`
          );
        }
        journal.write("tenure-resumed", {
          file: tenure.file ?? null,
          hiredAgentId: tenure.hiredAgentId,
          personaId: tenure.personaId,
          status: row.status,
          rung: tenure.rung ?? null,
          hiredAt: tenure.hiredAt ?? null,
        });
      });
    } else {

      // ── scan ───────────────────────────────────────────────────────────────
      const dossier = await phase(result, journal, "scan", async () => {
        const target = scenario.repo.rootPath ? { rootPath: scenario.repo.rootPath } : { repoUrl: scenario.repo.url };
        const started = must(
          "POST /api/repo-scan",
          await kp.post("/api/repo-scan", target),
          scenario.repo.rootPath
            ? `is KP_APP_MASTER_REPO_ROOTS set on the kp host so it admits ${scenario.repo.rootPath}?`
            : ""
        );
        const scanId = started.scanId;
        journal.write("scan-started", { scanId, target });
        const row = await poll(
          async () => {
            const res = await kp.get(`/api/repo-scan/${scanId}`);
            const scan = res.json?.scan;
            return scan && (scan.status === "complete" || scan.status === "failed") ? scan : null;
          },
          { maxMs: opts.scanTimeoutMs, everyMs: 3_000, label: `repo scan ${scanId} to finish` }
        );
        if (row.status !== "complete") {
          throw new PhaseError("scan", `the repo scan failed: ${row.error ?? "no reason recorded"}`, { scanId });
        }
        result.scan = {
          scanId,
          source: row.source,
          isLocal: row.isLocal,
          contexts: row.dossier?.size?.contexts ?? null,
          files: row.dossier?.size?.files ?? null,
          declaredGates: row.dossier?.declaredGates ?? [],
        };
        if (scenario.mode === "keyless" && row.source !== "heuristic") {
          throw new PhaseError(
            "scan",
            `a keyless run must scan by file walk, but the scan reported source "${row.source}" — is KP_OFFLINE=1 set on the kp host?`
          );
        }
        journal.write("scan-complete", result.scan);
        return { scanId, dossier: row.dossier };
      });

      // ── intake ─────────────────────────────────────────────────────────────
      await phase(result, journal, "intake", async () => {
        const created = must("POST /api/intake", await kp.post("/api/intake", { lang: "en", scanId: dossier.scanId }));
        if (created.shape !== "app_master") {
          throw new PhaseError("intake", `the session was stamped shape "${created.shape}" — a scanId should make it app_master`);
        }
        result.intakeId = created.id;
        must(
          "POST /api/intake/[id]/dossier",
          await kp.post(`/api/intake/${created.id}/dossier`, { scanId: dossier.scanId, dossier: dossier.dossier })
        );
        journal.write("intake-ready", { intakeId: created.id });
      });

      // ── dialog ─────────────────────────────────────────────────────────────
      await phase(result, journal, "dialog", async () => {
        const answers = dialogAnswers(scenario, runTag);
        for (let i = 0; i < answers.length; i++) {
          const res = await kp.post(`/api/intake/${result.intakeId}/message`, { message: answers[i] });
          const body = must(`POST /api/intake/[id]/message (turn ${i + 1})`, res);
          const turn = { turn: i + 1, answer: answers[i], source: body.source, ms: res.ms, done: !!body.done };
          result.dialog.push(turn);
          journal.write("dialog-turn", { ...turn, reply: String(body.reply ?? "").slice(0, 200) });
          if (scenario.mode === "keyless" && body.source !== "deterministic") {
            throw new PhaseError(
              "dialog",
              `turn ${i + 1} was answered by source "${body.source}" — a keyless run must run the deterministic slot script (KP_OFFLINE=1 on the kp host)`
            );
          }
        }
      });

      // ── compose ────────────────────────────────────────────────────────────
      await phase(result, journal, "compose", async () => {
        const body = must(
          "POST /api/intake/[id]/compose-app-master",
          await kp.post(`/api/intake/${result.intakeId}/compose-app-master`)
        );
        result.spec = body.spec;
        result.populationFit = body.fit ?? null;
        result.specHighlights = {
          title: body.spec?.role?.title ?? null,
          population: body.spec?.role?.population ?? null,
          scopeRung: body.spec?.mandate?.scopeRung ?? null,
          forbiddenClasses: body.spec?.mandate?.forbiddenClasses?.length ?? null,
          approvalGates: body.spec?.mandate?.approvalGates?.length ?? null,
          budgetUsd: body.spec?.budget?.monthlyUsd ?? null,
          probationDays: body.spec?.tenure?.probationDays ?? null,
          objectives: (body.spec?.objectives ?? []).map((o) => o.kpiKey),
          coercionNotes: body.spec?.coercionNotes ?? [],
        };
        journal.write("composed", result.specHighlights);
      });

      // ── dispatch ───────────────────────────────────────────────────────────
      //
      // Callable more than once: a build that dies in Personas is re-dispatched
      // against the SAME intake and the same composed spec (see MAX_BUILD_ATTEMPTS).
      const buildFailures = [];
      const dispatchHire = async (attempt) => {
        let res = await kp.post("/api/agents/dispatch", { intakeId: result.intakeId });
        // kp's OWN bridge key expires too (24h, headless auto-pair), and it
        // surfaces here as a 502 whose code is AGENT_BRIDGE_KEY_INVALID. Re-pair
        // kp and retry ONCE: a dead credential must not read as a failed hire.
        if (!res.ok && readsAsBridgeKeyFailure(res) && (await repairKpKey("POST /api/agents/dispatch", res))) {
          res = await kp.post("/api/agents/dispatch", { intakeId: result.intakeId });
        }
        const body = must("POST /api/agents/dispatch", res);
        // A RE-dispatch has to mint a SECOND hire, never hand the dead one back.
        // kp's one-live-agent-per-intake read (`getActiveHiredAgentForIntake`)
        // counts only `dispatched|pending_approval|onboarding|active`, so the
        // `failed` row the refresh poll just wrote is already out of the way —
        // which is why this retry needs no kp-side change. `existing: true` here
        // would mean kp still counts a dead build as live, and a "retry" against
        // it would measure nothing; it is refused out loud rather than papered over.
        if (attempt > 1 && body.existing) {
          throw new PhaseError(
            "activate",
            `re-dispatch after a failed build returned the EXISTING hire ${body.hiredAgentId} (status \`${body.status}\`) — kp still counts that build live, so this scenario cannot be retried`,
            { hiredAgentId: body.hiredAgentId, status: body.status }
          );
        }
        result.hire = {
          hiredAgentId: body.hiredAgentId,
          requestId: body.requestId,
          status: body.status,
          buildAttempts: attempt,
          buildFailures,
        };
        journal.write("dispatched", { ...result.hire, buildFailures: buildFailures.length });
        return result.hire;
      };
      await phase(result, journal, "dispatch", () => dispatchHire(1));

      // ── activate ───────────────────────────────────────────────────────────
      /** ONE build's wait. Resolves active/terminal; a timeout throws (orphan). */
      const attemptActivate = async () => {
        const seen = [];
        let terminal = null;
        const row = await poll(
          async () => {
            const res = await kp.post(`/api/agents/${result.hire.hiredAgentId}/refresh`);
            // The pull fallback answers 200 with `refreshed:false` when the poll
            // itself failed — including when Personas rejected kp's key. Repair
            // and let the next tick re-read rather than waiting out the timeout
            // against a credential that will never work.
            if (res.json?.refreshed === false && readsAsBridgeKeyFailure(res)) {
              await repairKpKey("POST /api/agents/[id]/refresh", res);
              return null;
            }
            const status = res.json?.agent?.status ?? null;
            if (status && seen[seen.length - 1] !== status) seen.push(status);
            // A terminal non-active status is an ANSWER, not something to wait
            // out — a held/failed build now maps to `failed` on the wire. Returned
            // rather than thrown: `poll` swallows a thrown predicate error and
            // would keep waiting for the full timeout, which would then be
            // reported as an orphaned build that is in fact already dead.
            if (status === "failed" || status === "rejected" || status === "retired") {
              terminal = status;
              return { terminal: status };
            }
            return status === "active" ? res.json.agent : null;
          },
          { maxMs: scenario.activateTimeoutMs ?? opts.activateTimeoutMs, everyMs: 3_000, label: "the hire to reach `active` in Personas (headless mode auto-approves)" }
        ).catch((error) => {
          // A TIMED-OUT activate leaves the dispatched build session RUNNING on
          // the Personas side: the request was accepted, the one-shot Claude Code
          // build is under way, and there is no cancel endpoint on the bridge to
          // stop it. The driver cannot clean it up, so it names what it left
          // behind — the next sweep's operator needs to know which request is
          // still burning a session and may yet push a report.
          journal.write("orphan-build", {
            requestId: result.hire.requestId ?? null,
            hiredAgentId: result.hire.hiredAgentId,
            personaId: result.hire.personaId ?? null,
            lastStatus: seen[seen.length - 1] ?? null,
            ladder: seen,
            waitedMs: scenario.activateTimeoutMs ?? opts.activateTimeoutMs,
            note: "activate timed out; the Personas build session for this request is still running and nothing cancels it (the bridge has no cancel endpoint). It may still reach `active` and push a report after this run ends.",
          });
          result.warnings.push(
            `orphan build: request ${result.hire.requestId ?? "?"} was still building when activate timed out — it is left running (no cancel endpoint) and may push a report after this run.`
          );
          throw error;
        });
        if (terminal) {
          return {
            ok: false,
            terminal,
            ladder: seen,
            requestId: result.hire.requestId ?? null,
            hiredAgentId: result.hire.hiredAgentId,
          };
        }
        return { ok: true, row, ladder: seen };
      };
      await phase(result, journal, "activate", async () => {
        const build = await buildWithRetry({
          activate: attemptActivate,
          dispatch: dispatchHire,
          journal,
          failures: buildFailures,
          // Personas' own reading of what killed the build, when it has one. A
          // refused or silent status read is NOT a reason — it stays null.
          reasonFor: async (requestId) => {
            if (!requestId) return null;
            const res = await personas.get(`/api/kp/persona-requests/${encodeURIComponent(requestId)}`).catch(() => null);
            return res?.ok ? buildFailureReason(res.json) : null;
          },
        });
        result.hire.buildAttempts = build.attempts;
        if (build.failures.length > 0) {
          // A flaky build is a FINDING about Personas, not a detail to swallow:
          // it rides the run's warnings even when the retry succeeded.
          result.warnings.push(
            `build reliability: ${build.failures.length} of ${build.attempts} build(s) for this hire ended \`failed\` in Personas — ${build.failures
              .map((f) => `attempt ${f.attempt} (${f.requestId ?? "no request id"}): ${f.reason ?? "no reason reported"}`)
              .join("; ")}`
          );
        }
        if (!build.ok) {
          throw new PhaseError(
            "activate",
            `the hire reached terminal status \`${build.terminal}\` (ladder: ${build.ladder.join(" → ")}) on build attempt ${build.attempts} of ${MAX_BUILD_ATTEMPTS}`
          );
        }
        result.hire.statusLadder = build.ladder;
        result.hire.personaId = build.row.personaId ?? null;
        result.hire.personaName = build.row.personaName ?? null;
        journal.write("activated", {
          ladder: build.ladder,
          personaId: result.hire.personaId,
          buildAttempts: build.attempts,
          buildFailures: build.failures.length,
        });
      });

      // ── tenure-write ───────────────────────────────────────────────────────
      // The preamble's real product on a `--hire-only` run: the handles every
      // later run resumes from. Written AFTER activate, because a hire with no
      // personaId is a handle no tick can be scoped by.
      if (plan.mode === "hire-only") {
        await phase(result, journal, "tenure-write", async () => {
          const record = tenureRecordFrom({ scenario, result });
          writeTenureFile(opts.tenureFile, record);
          result.tenureWritten = { file: opts.tenureFile, record };
          journal.write("tenure-written", { file: opts.tenureFile, ...record });
        });
      }
    }

    if (plan.mode === "hire-only") {
      for (const name of TENURE_PHASES) skipPhase(name, plan.reason);
      result.unmeasured.push(
        "--hire-only: no night ran, so nothing about the holder was measured — this run's product is the tenure file"
      );
    } else {

      // ── seed ───────────────────────────────────────────────────────────────
      // Between activate and nights, and in that order for a reason: the seed
      // targets the project the HIRE bound, which does not exist until the hire
      // is active, and the work has to be on the backlog before the first tick's
      // triage pass reads it.
      //
      // A scenario with no `seeds` skips the phase and SAYS SO in `unmeasured`:
      // sweeps #11 and #12 dispatched zero for exactly this reason, and a silent
      // skip is how that stayed invisible for two sweeps.
      await phase(result, journal, "seed", async () => {
        const seeds = scenario.seeds ?? [];
        if (seeds.length === 0) {
          result.seed = { requested: 0, seeded: 0, skipped: 0, reason: "the scenario declares no seeds" };
          result.unmeasured.push(
            "seed: the scenario declares no `seeds`, so the night has no backlog work — every delivery-side backbone field will read null"
          );
          journal.write("seed-skipped", { reason: "no seeds in the scenario" });
          return;
        }

        const res = await personas.post("/api/kp/test/seed-work", {
          personaId: result.hire.personaId,
          // The run stamp rides in the DEDUP KEY (server-side salt), not only in
          // the title: the ideas normalizer strips bracketed stamps, so titles
          // alone deduped a later run's seeds to nothing (sweep #18).
          dedupeSalt: stamp,
          // Run-unique titles: the ideas store dedupes by normalized title and
          // never re-offers an already-triaged idea, so the same seed on the same
          // project dispatches exactly once EVER. Sweep #16 (2026-08-25) seeded
          // 0/4 because sweep #15 had written the identical four. The stamp keeps
          // every run's seeds — and the branches named after them — its own.
          items: seeds.map(({ title, description, acceptance, trap }) => ({
            title: `${title} [bench ${stamp}]`,
            ...(description ? { description } : {}),
            ...(acceptance ? { acceptance } : {}),
            ...(trap ? { trap } : {}),
          })),
        });

        if (res.status === 404) {
          // 404 on this route means the ROUTE is absent, not the project: the
          // headless bridge adds `/api/kp/test/*` only while the mode is on, and
          // preflight already proved the mode IS on. So an older Personas is the
          // reading — name it rather than letting the run limp to a zero-dispatch
          // night the scorecard would blame on the agent.
          throw new PhaseError(
            "seed",
            `POST /api/kp/test/seed-work answered 404. Preflight confirmed headlessBridge:true, so the route itself is missing — this Personas build predates the seed endpoint (personas §13.9 of docs/architecture/cloud-integration-bridge.md, commit "feat(kp-bridge): headless seed-work endpoint"). Update and restart personas-desktop, or run with --stub-personas. Body: ${res.text.slice(0, 200)}`,
            { status: 404, body: res.json }
          );
        }
        const envelope = must("POST /api/kp/test/seed-work", res);
        const body = envelope.data ?? envelope;
        const seedOutcome = body.seed ?? body;

        result.seed = {
          requested: seeds.length,
          projectId: seedOutcome.projectId ?? null,
          seeded: seedOutcome.seeded ?? null,
          skipped: seedOutcome.skipped ?? null,
          triageRule: seedOutcome.triageRule ?? null,
          notes: seedOutcome.notes ?? [],
          acceptanceStored: body.acceptanceStored ?? null,
          // The seed→idea mapping the scorecard attributes proposal branches with.
          items: seedOutcome.items ?? [],
          response: body,
        };
        journal.write("seeded", {
          requested: seeds.length,
          seeded: result.seed.seeded,
          skipped: result.seed.skipped,
          triageRuleWillAccept: result.seed.triageRule?.willAccept ?? null,
          notes: result.seed.notes,
          mapping: (result.seed.items ?? []).map((i) => ({
            index: i.index,
            title: i.title,
            ideaId: i.id ?? null,
            accepted: i.accepted,
            trap: i.trap ?? null,
          })),
        });

        // Personas reports these rather than working around them — so does the
        // driver. Neither is a phase failure: the night still runs and the
        // expectations still read what it did.
        for (const note of result.seed.notes) result.warnings.push(`seed: ${note}`);
        if (result.seed.triageRule && result.seed.triageRule.willAccept === false) {
          result.unmeasured.push(
            "seed: the auto-accept triage rule will not accept these seeds, so tonight's overnight has nothing to dispatch"
          );
        }
        if (result.seed.seeded === 0) {
          result.unmeasured.push(
            `seed: all ${seeds.length} item(s) were deduped away — this project already holds them, so tonight's triage pass has no NEW pending work to accept`
          );
        }
      });

      // ── nights ─────────────────────────────────────────────────────────────
      await phase(result, journal, "nights", async () => {
        const settleTimeoutMs = scenario.settleTimeoutMs ?? opts.settleTimeoutMs;
        for (let n = 1; n <= scenario.nights; n++) {
          const t = Date.now();
          const tickPhase = async (phases) => {
            const res = await personas.post("/api/kp/test/tick", { personaId: result.hire.personaId, phases });
            return {
              ok: res.ok,
              summary: res.json?.data ?? res.json ?? null,
              error: res.ok ? null : (res.error ?? `${res.status} ${res.text.slice(0, 200)}`),
              status: res.status,
            };
          };

          // (a) dispatch the fleet.
          const overnight = await tickPhase(["overnight"]);
          const dispatched = dispatchedCount(overnight.summary);
          journal.write("night-overnight", {
            night: n,
            ok: overnight.ok,
            dispatched,
            counts: phaseCounts(overnight.summary, "overnight") ?? null,
            ...(overnight.error ? { error: overnight.error } : {}),
          });

          // (b) let the dispatched sessions author their branches, reconciling on
          //     a poll until the dispatch is accounted for.
          const settle = await settleDispatch({
            tickReconcile: () => tickPhase(["reconcile"]),
            journal,
            night: n,
            dispatched,
            pollMs: opts.settlePollMs,
            timeoutMs: settleTimeoutMs,
            // A committed proposal, per the roster's tenure-scoped reading (P6o):
            // push a rollup, read the row, take proposalsOpened.
            confirmOpened: async () => {
              await tickPhase(["report"]);
              const row = await rosterRow();
              const n = row ? readingFromRoster(row).proposalsOpened : null;
              return typeof n === "number" ? n : null;
            },
          });

          // (c) only now report: the rollup pushed here is what kp scores.
          const report = await tickPhase(["report"]);

          const ticks = [overnight, settle.polls.length > 0 ? { ok: true, summary: settle.lastSummary } : null, report];
          const summary = mergeTickSummaries(ticks.map((x) => x?.summary));
          const tickOk = overnight.ok && report.ok;
          const night = {
            night: n,
            ms: Date.now() - t,
            tick: summary,
            tickOk,
            settle,
            reading: {},
            readingSource: {},
            backbone: null,
            appMaster: null,
            // C1 (c1-exam §3): the night's OWN judgment — what it proposed and
            // what it declined. Extracted here so the record carries the lists
            // rather than only the summary they were buried in; absent stays
            // absent, and the expectation checks read the absence as `null`.
            c1: extractNightLists(summary),
          };
          if (!night.c1.proposals) {
            result.unmeasured.push(
              `night ${n}: the tick summary carried no \`proposals\` list — a rung-0 ideation night's product is that list, and this Personas build does not ship it yet (c1-exam §7)`
            );
          }
          // DEGRADE HONESTLY: a missing or refusing tick route is recorded as an
          // unmeasured night, not a driver crash. The expectation checks then
          // fail on the absence, which is the correct reading.
          const failures = [
            ...(overnight.ok ? [] : [`overnight → ${overnight.status || "nothing"}`]),
            ...(report.ok ? [] : [`report → ${report.status || "nothing"}`]),
          ];
          if (failures.length > 0) {
            night.error = [overnight.error, report.error].filter(Boolean).join(" · ");
            result.unmeasured.push(`night ${n}: POST /api/kp/test/tick answered ${failures.join(", ")}`);
          }
          if (settle.stoppedBy === "timeout" || settle.stoppedBy === "stalled") {
            result.unmeasured.push(
              `night ${n}: the settle loop stopped \`${settle.stoppedBy}\` — ${settle.accounted ?? 0} of ${dispatched} dispatched session(s) were accounted for after ${settle.polls.length} reconcile poll(s), so the gate and merge lanes may be reported before the fleet finished`
            );
          }

          // The push report lands asynchronously; refresh, then read the roster.
          await kp.post(`/api/agents/${result.hire.hiredAgentId}/refresh`).catch(() => null);
          const row = await rosterRow();
          night.backbone = row?.backbone ?? null;
          night.appMaster = row?.appMaster ?? null;
          night.agentStatus = row?.status ?? null;
          night.kpiDeltas = row?.kpiDeltas ?? null;
          // The reading is the ROSTER's scored backbone folded over whatever the
          // tick summary reported inline — see mergeReadings() for which wins.
          const merged = mergeReadings(tickOk ? extractBackboneReading(summary) : {}, readingFromRoster(row));
          night.reading = merged.reading;
          night.readingSource = merged.source;
          if (typeof row?.aggregates?.costUsd === "number") result.costReportedUsd = row.aggregates.costUsd;
          if (!night.backbone) result.unmeasured.push(`night ${n}: no backbone was scored — nothing reported one`);
          result.nights.push(night);
          journal.write("night", {
            night: n,
            ms: night.ms,
            tickOk,
            dispatched,
            settled: { stoppedBy: settle.stoppedBy, polls: settle.polls.length, accounted: settle.accounted, ms: settle.ms },
            verdict: night.backbone?.verdict ?? null,
            coverage: night.backbone?.coverage ?? null,
            reading: night.reading,
            readingSource: night.readingSource,
            proposals: night.c1.proposals ? night.c1.proposals.map((p) => p?.title ?? p).slice(0, 20) : null,
            declines: night.c1.declines ? night.c1.declines.length : null,
          });
        }
      });

      // ── probation ──────────────────────────────────────────────────────────
      await phase(result, journal, "probation", async () => {
        const before = await rosterRow();
        const tick = await personas.post("/api/kp/test/tick", {
          personaId: result.hire.personaId,
          phases: ["probation"],
          // The scenario's probation window is days long and this is its last
          // phase — force the review DUE now (headless test lever; the decision
          // policy itself is the production path).
          forceProbation: true,
        });
        const summary = tick.json?.data ?? tick.json ?? null;
        await kp.post(`/api/agents/${result.hire.hiredAgentId}/refresh`).catch(() => null);
        const after = await rosterRow();
        // Only THIS hire's decision counts: a forced probation used to decide
        // every undecided mandate in the app, and the generic findFirst read
        // another project's `retired` as ours (sweeps #18/#21). The tick is now
        // scoped server-side too; the filter here is the driver's own guarantee.
        const details = Array.isArray(summary?.phases)
          ? summary.phases.flatMap((p) => (Array.isArray(p?.details) ? p.details : []))
          : [];
        const mine = details.find((d) => d && d.personaId === result.hire.personaId && d.decision);
        const reported = mine ? mine.decision : undefined;
        const decision =
          typeof reported === "string"
            ? reported
            : after && after.status !== before?.status
              ? (STATUS_TO_DECISION[after.status] ?? null)
              : null;
        result.probation = {
          tickOk: tick.ok,
          tick: summary,
          ...(tick.ok ? {} : { error: tick.error ?? `${tick.status} ${tick.text.slice(0, 200)}` }),
          decision,
          decisionSource: typeof reported === "string" ? "reported" : decision ? "derived-from-status" : "none",
          statusBefore: before?.status ?? null,
          statusAfter: after?.status ?? null,
          backbone: after?.backbone ?? null,
        };
        if (!decision) result.unmeasured.push("probation: no decision was reported and the status did not move");
        journal.write("probation", { decision, source: result.probation.decisionSource, status: after?.status ?? null });
      });
    }
  } catch (error) {
    result.failedPhase = error?.phase ?? "unknown";
    if (!(error instanceof PhaseError)) {
      result.errors.push({ phase: result.failedPhase, ok: false, error: String(error?.stack || error) });
    }
    journal.write("run-error", { phase: result.failedPhase, error: String(error?.message || error) });
  }

  // ── expectations ──────────────────────────────────────────────────────────
  // Evaluated even after a phase failure: what a broken run DID read is still
  // the most useful thing in the file. NOT evaluated on a `--hire-only` run:
  // the scenario's expect block is about nights that did not run, and grading
  // an absence as a failure would make the hire look like a bad one.
  if (plan.mode === "hire-only") {
    result.unmeasured.push(
      `expectations: --hire-only ran no night, so ${Object.keys(scenario.expect ?? {}).length} expectation(s) were not evaluated`
    );
  }
  const evaluated = plan.mode === "hire-only" ? { ok: true, checks: [] } : evaluateExpectations(scenario, result);
  result.expectations = evaluated.checks;
  result.ok = result.failedPhase === null && evaluated.ok;
  result.finishedAt = new Date().toISOString();
  result.wallMs = Date.now() - t0;
  result.throttledMs = throttledMs;
  if (throttledMs > 0) {
    result.warnings.push(
      `kp rate-limited this run for ${Math.round(throttledMs / 1000)}s in total — a sweep of several scenarios crosses the per-IP intake and repo-scan windows.`
    );
  }

  writeFileSync(path.join(runDir, "result.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
  journal.write("run-end", { ok: result.ok, failedPhase: result.failedPhase, wallMs: result.wallMs });
  return result;
}

// ─── CLI ────────────────────────────────────────────────────────────────────

function printSummary(result) {
  const banner = verdictBanner([
    `${result.scenario.name} ${result.ok ? "PASS" : "FAIL"}`,
    result.runMode && result.runMode !== "fresh-hire" ? result.runMode : "",
    result.tenureWritten ? `wrote ${path.basename(result.tenureWritten.file)}` : "",
    result.failedPhase ? `phase ${result.failedPhase} failed` : `${result.phases.length} phases`,
    result.seed?.requested ? `seeded ${result.seed.seeded ?? "?"}/${result.seed.requested}` : "no seeds",
    `${result.nights.length} night(s)`,
    result.probation?.decision ? `probation ${result.probation.decision}` : "probation –",
    humanMs(result.wallMs),
    result.personas.stub ? "STUB Personas" : "",
  ]);
  process.stderr.write(`\n${banner}\n`);
  for (const check of result.expectations) {
    process.stderr.write(`  ${glyph(check.ok)} ${check.name}: expected ${check.expected}, got ${JSON.stringify(check.actual)} — ${check.delta}\n`);
  }
  for (const w of result.warnings) process.stderr.write(`  ! ${w}\n`);
  for (const u of result.unmeasured) process.stderr.write(`  ${glyph(null)} unmeasured — ${u}\n`);
  process.stderr.write(`  → ${result.runDir}\n`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(
      [
        "App-master mass-test driver",
        "",
        "  --scenario <name|path>   one scenario (default: kp-default)",
        "  --all                    every scenario in scenarios/, SERIALLY",
        "  --tenure <name|path>     run against an EXISTING hire (tenures/<name>.json):",
        "                           skips scan/intake/dialog/compose/dispatch/activate",
        "  --hire-only              run the preamble ONCE and write the tenure file,",
        "                           then stop (no seed, no nights, no probation).",
        "                           With --tenure, that path is the destination.",
        "  --strict                  a hired agent no tenure file names BLOCKS preflight",
        "                           (without it the orphans are listed and the run goes on)",
        "  --backlog <file>         the operator's ranked backlog for `rankVsBacklog`:",
        "                           JSON [{title, value}] (or {items:[…]}), PRE-SCORED —",
        "                           scoring a title is /value-ledger's job, not the driver's",
        "  --kp <url>               kp base url            (default http://localhost:3101)",
        "  --personas <url>         Personas base url      (default http://127.0.0.1:9420)",
        "  --personas-key pk_…      skip the driver's own pairing",
        "  --stub-personas          run an in-process stub Personas instead (canned numbers)",
        "  --stub-build-fail-once   with --stub-personas: the FIRST hire build fails the",
        "                           way a real one does, so the build retry runs",
        "  --mode keyless|keyed     override every scenario's mode",
        "  --nights N               override every scenario's night count",
        "  --throttle-wait <ms>     how long to sit out a kp 429 (default 65000; kp's",
        "                           per-IP windows are fixed 10-minute buckets)",
        "  --settle-poll <ms>       gap between the reconcile polls that wait out a",
        "                           night's dispatched fleet sessions (default 90000)",
        "  --settle-timeout <ms>    how long a night may settle before it reports",
        "                           anyway, unmeasured lanes and all (default 1800000;",
        "                           a scenario's `settleTimeoutMs` overrides it)",
        "  --out <dir>              bench root (default bench/app-master)",
        "  --report                 also write bench/app-master/REPORT.md when done,",
        "                           pass or fail (what `npm run bench:app-master` does)",
        "",
      ].join("\n")
    );
    return 0;
  }

  const benchRoot = args.out ? path.resolve(args.out) : DEFAULT_BENCH_ROOT;
  const files = args.all
    ? listScenarioFiles()
    : [resolveScenarioPath(String(args.scenario || "kp-default"))];
  if (files.length === 0) {
    process.stderr.write("no scenarios found\n");
    return 1;
  }

  const scenarios = files.map((f) => {
    if (!existsSync(f)) throw new Error(`scenario file not found: ${f}`);
    const s = loadScenarioFile(f, { kpRoot: REPO_ROOT });
    if (args.mode) s.mode = String(args.mode);
    if (args.nights !== undefined) s.nights = Number(args.nights);
    return s;
  });

  // ── tenure resolution (c1-exam §1) ────────────────────────────────────────
  // `--tenure` beats the scenario's own `tenure` field; `--hire-only` turns
  // whichever one is in force into the DESTINATION of a fresh hire. Resolved
  // here, before anything is paired, so a bad handle fails in a second rather
  // than forty minutes in.
  const hireOnly = !!args["hire-only"];
  const tenureFlag = typeof args.tenure === "string" ? args.tenure : null;
  if (hireOnly && tenureFlag && scenarios.length > 1) {
    throw new Error("--hire-only --tenure <file> names ONE destination; run it for one scenario at a time");
  }
  const tenureFor = (scenario) => {
    const named = tenureFlag ?? (typeof scenario.tenure === "string" ? scenario.tenure : null);
    const file = resolveTenurePath(named ?? tenureNameFor(scenario));
    if (hireOnly) {
      // A second App master on the same repo is a deliberate experiment that
      // names itself (`kp-owner-b`), never an accident of a re-run — so a
      // hire-only run refuses to overwrite a tenure that already exists.
      if (existsSync(file)) {
        throw new Error(
          `--hire-only would overwrite ${file}, which already names a live tenure. Retire that one first, or name this experiment: --tenure ${path.basename(file, ".json")}-b`
        );
      }
      return { tenure: null, tenureFile: file };
    }
    if (!named) return { tenure: null, tenureFile: null };
    if (!existsSync(file)) throw new Error(`tenure file not found: ${file} — hire one first with --hire-only`);
    return { tenure: loadTenureFile(file), tenureFile: file };
  };

  // ── the operator's backlog (c1-exam §3) ───────────────────────────────────
  // Pre-scored rows, read once for the whole sweep. Every row must carry a
  // title; a row with no `value` keeps its FILE ORDER, so an unscored backlog
  // is still the order somebody wrote it in rather than a silent re-ranking.
  let backlog = null;
  if (args.backlog) {
    const file = path.resolve(String(args.backlog));
    if (!existsSync(file)) throw new Error(`backlog file not found: ${file}`);
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    const items = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.items) ? parsed.items : null;
    if (!items) throw new Error(`backlog ${file}: expected a JSON array of {title, value} rows, or { items: [...] }`);
    const untitled = items.filter((row) => !(typeof row?.title === "string" && row.title.trim())).length;
    if (untitled > 0) throw new Error(`backlog ${file}: ${untitled} row(s) carry no title — a title is what an overlap is measured on`);
    backlog = {
      file,
      items: items.map((row) => ({ title: String(row.title).trim(), value: typeof row.value === "number" ? row.value : null })),
      scored: items.filter((row) => typeof row.value === "number").length,
    };
    process.stderr.write(`operator backlog: ${backlog.items.length} row(s), ${backlog.scored} scored — ${file}\n`);
  }

  const kpUrl = String(args.kp || process.env.KP_BENCH_URL || "http://localhost:3101");

  let stub = null;
  let personasUrl = String(args.personas || process.env.PERSONAS_BENCH_URL || "http://127.0.0.1:9420");
  let personasKey = args["personas-key"] ? String(args["personas-key"]) : process.env.PERSONAS_API_KEY || null;

  const keyCacheFile = path.join(benchRoot, "personas-key.json");
  if (!personasKey && existsSync(keyCacheFile)) {
    try {
      const cached = JSON.parse(readFileSync(keyCacheFile, "utf8"));
      if (cached.baseUrl?.replace(/\/$/, "") === personasUrl.replace(/\/$/, "")) personasKey = cached.apiKey;
    } catch {
      /* a corrupt cache just means re-pairing */
    }
  }

  if (args["stub-personas"]) {
    const { startStubPersonas } = await import("./stub.mjs");
    stub = await startStubPersonas({ kpBaseUrl: kpUrl, buildFailsOnce: !!args["stub-build-fail-once"] });
    personasUrl = stub.url;
    personasKey = null; // the stub mints its own; pair against it for real
    process.stderr.write(`stub Personas (headless bridge, CANNED numbers) at ${personasUrl}\n`);
    if (args["stub-build-fail-once"]) {
      process.stderr.write("  …with the first hire build FAILING on purpose — the run must retry it once and say so\n");
    }
  }

  const opts = {
    kpUrl,
    personasUrl,
    personasKey,
    benchRoot,
    stub: !!stub,
    // A stub run never writes the cache: its key dies with the process.
    keyCacheFile: stub ? null : keyCacheFile,
    scanTimeoutMs: Number(args["scan-timeout"] || 20 * 60_000),
    // A real headless hire runs a full one-shot BUILD SESSION (a live Claude
    // Code session: design pass + build) before the request can reach `active`
    // — sweep #6 MEASURED 32 min end to end (13:55→14:27), and 20 min still timed
    // out on a healthy build (sweep #7). 45 min
    // holds a slow session; override with --activate-timeout (ms).
    // Live builds measured 32–80+ min (turn-by-turn Claude sessions competing
    // with the desktop's other AI work). A scenario can override with
    // `activateTimeoutMs`; the flag beats both.
    activateTimeoutMs: Number(args["activate-timeout"] || 90 * 60_000),
    // How long to sit out a 429 before retrying. kp's windows are fixed
    // 10-minute buckets, so 65s × 12 attempts crosses one from anywhere inside it.
    throttleWaitMs: Number(args["throttle-wait"] || 65_000),
    // The settle wait between `overnight` and `report`. 90s between reconcile
    // polls because a fleet session writes a branch in minutes, not seconds, and
    // each poll is a real bridge call; 30 min total because a night that has not
    // produced a branch by then produced nothing this run can measure — and
    // reporting an unmeasured lane on time beats waiting for one forever.
    settlePollMs: Number(args["settle-poll"] || 90_000),
    settleTimeoutMs: Number(args["settle-timeout"] || 30 * 60_000),
    // Hygiene, enforced rather than reported: an orphan fleet blocks preflight.
    strict: !!args.strict,
    backlog,
  };

  const results = [];
  try {
    // SERIAL, ALWAYS — and this is a deliberate constraint, not a TODO. A live
    // night runs the App master through the local Claude CLI, which is one
    // subscription seat: two scenarios at once do not halve the wall clock,
    // they collide on the session limit and both degrade. One at a time.
    for (const scenario of scenarios) {
      const { tenure, tenureFile } = tenureFor(scenario);
      const plan = planPhases({ tenure, hireOnly });
      process.stderr.write(
        `\n=== ${scenario.name} (${scenario.mode}, ${scenario.nights} night(s), ${plan.mode}${
          tenureFile ? ` → ${path.basename(tenureFile)}` : ""
        }) ===\n`
      );
      const result = await runScenario(scenario, { ...opts, tenure, tenureFile, hireOnly });
      results.push(result);
      printSummary(result);
    }
  } finally {
    await stub?.close();
    // `--report` renders the aggregate IN-PROCESS, so a sweep that failed still
    // writes REPORT.md — an `&&` chain would skip it exactly when it matters.
    if (args.report) {
      const { writeReport } = await import("./report.mjs");
      const { dest, runs } = writeReport(benchRoot);
      process.stderr.write(`
wrote ${dest} (${runs} run(s))
`);
    }
  }

  const failed = results.filter((r) => !r.ok);
  process.stderr.write(
    `\n${verdictBanner([
      `${results.length - failed.length}/${results.length} scenarios PASS`,
      failed.length > 0 ? `${failed.length} FAIL: ${failed.map((r) => `${r.scenario.name}${r.failedPhase ? `@${r.failedPhase}` : ""}`).join(", ")}` : "",
    ])}\n`
  );
  return failed.length === 0 ? 0 : 1;
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      process.stderr.write(`\nbench driver failed: ${String(error?.stack || error)}\n`);
      process.exitCode = 1;
    });
}

export { runScenario, findFirst };

