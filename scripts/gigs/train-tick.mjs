#!/usr/bin/env node
/**
 * train-tick - one idempotent "training tick" over a fixed set of oss_bounty gigs.
 *
 * Run it (from the kp repo root) via the alias loader, NOT the dev server:
 *
 *   node --env-file=.env.local --experimental-transform-types \
 *        --import ./scripts/test-alias-loader.mjs \
 *        scripts/gigs/train-tick.mjs [--once]
 *
 * It performs ONE pass and exits; the operator calls it repeatedly. Each pass
 * advances every gig in the set by AT MOST one step, within a concurrency budget:
 *
 *   1. Reconcile  - read each gig + its latest attempt from the DB and classify a
 *                   stage (the DB is the truth; the state file is a cache/log).
 *   2. Specialist - ensure one live oss_bounty specialist; hire if none. Approve a
 *                   pending 'OSS bounties' hire (never freelance's). onboarding =>
 *                   persona building, skip dispatch this pass.
 *   3. Qualify    - qualifyAndMatch every `new` gig.
 *   4. Count      - in-flight = gigs `dispatched`|`running` (+ a building hire).
 *   5. Dispatch   - while in-flight < max AND the specialist is active, take the
 *                   next `qualified` gig, prepare its project, dispatch one attempt.
 *   6. Sync       - one syncGigAttempts pass (dispatched -> drafted|failed).
 *   7. Checkpoint - append this pass's events to the state file; print a summary.
 *
 * THE HUMAN-SEND GATE STAYS. The terminal state per gig is `drafted` (waiting for
 * the operator's manual review). This driver has NO path that approves a draft,
 * marks an attempt sent, or submits/reviews-sends anything. Grep this file: the
 * only "approve" it performs is the Personas HIRE approval (a persona build), never
 * an attempt/deliverable approval. Its last act each pass is to print the summary.
 *
 * Arena scope: only gigs in the set (all oss_bounty). It never transitions,
 * declines or dispatches a non-oss gig, and never approves a non-'OSS bounties'
 * hire (that is the freelance process's).
 *
 * Crash-safe + idempotent: every pass reconciles real state from the DB, so it is
 * safe to run after a crash. No dev-server HTTP; no direct SQL (the store functions
 * are compare-and-swap). Exit 0 always for a pass (usage errors exit 2).
 *
 * Node builtins only at module top level; the kp store (TypeScript) is imported
 * lazily inside runPass, so `node --test` can load the pure helpers below WITHOUT
 * the alias loader and WITHOUT touching the DB.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// ---------------------------------------------------------------------------
// Constants (arena is FIXED - this process never touches another arena)
// ---------------------------------------------------------------------------

export const ARENA = "oss_bounty";
/** The Personas workspace an oss_bounty hire is filed in (GIG_ARENA_WORKSPACE_NAME
 *  in app/_lib/gigs/project.ts). Only a hire for THIS workspace may be approved. */
export const OSS_WORKSPACE_NAME = "OSS bounties";
/** The note stamped on every hire approval this process performs. */
export const APPROVE_NOTE = "oss training";
export const DEFAULT_PERSONAS_DIR = "C:/Users/kazda/kiro/personas";

const SCRATCH_GIGS =
  "C:/Users/kazda/AppData/Local/Temp/claude/C--Users-kazda-kiro-kp/86bbf835-49fb-48b0-9c11-6147d7f526ca/scratchpad/gigs";

export const DEFAULTS = {
  set: `${SCRATCH_GIGS}/train-set.json`,
  state: `${SCRATCH_GIGS}/train-state.json`,
  maxInflight: 2,
  niche: "frontend, docs and TypeScript",
  once: false,
  help: false,
};

/** The stage vocabulary the classifier emits, in report order. */
export const STAGES = ["missing", "new", "qualified", "dispatched", "running", "drafted", "failed", "other"];

/** hired_agents statuses under which the specialist is BUILDING (occupies a run
 *  slot but cannot receive a dispatch yet). `active` is the only status a dispatch
 *  may start from; the terminal-bad states (rejected/failed/retired) mean re-hire. */
export const HIRE_BUILDING_STATUSES = ["dispatched", "pending_approval", "onboarding"];

export const EXIT = { OK: 0, USAGE: 2 };

export const HELP = `usage: node --env-file=.env.local --experimental-transform-types \\
  --import ./scripts/test-alias-loader.mjs scripts/gigs/train-tick.mjs [options]

One idempotent training pass over a fixed set of oss_bounty gigs. Stops at drafted;
never sends. Call it repeatedly.

  --set <path>          the gig-id set (JSON array)   [default in scratchpad]
  --state <path>        this run's checkpoint/log      [default in scratchpad]
  --max-inflight <n>    concurrent runs of this process (default ${DEFAULTS.maxInflight})
  --niche <s>           specialist niche (default "${DEFAULTS.niche}")
  --personas-dir <p>    Personas checkout for operator-approvals.mjs
                        (default ${DEFAULT_PERSONAS_DIR}, or PERSONAS_DIR)
  --once                do exactly one pass and exit (the only mode; explicit)
  --help, -h            this text

Env: GIG_WS (workspace, default "workspace"), PERSONAS_DIR.`;

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested, no DB, no I/O)
// ---------------------------------------------------------------------------

/** Parse argv into the pass's options. Throws on an unknown flag or a missing
 *  value. Pure: env-derived values (GIG_WS, PERSONAS_DIR) are resolved in main. */
export function parseArgs(argv) {
  const out = { ...DEFAULTS, personasDir: null };
  const takesValue = {
    "--set": "set",
    "--state": "state",
    "--niche": "niche",
    "--personas-dir": "personasDir",
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a in takesValue) {
      const v = argv[i + 1];
      if (typeof v !== "string" || v.startsWith("--")) throw new Error(`${a} needs a value`);
      out[takesValue[a]] = v;
      i++;
    } else if (a === "--max-inflight") {
      const v = argv[i + 1];
      const n = Number(v);
      if (!Number.isInteger(n) || n <= 0) throw new Error("--max-inflight needs a positive integer");
      out.maxInflight = n;
      i++;
    } else if (a === "--once") {
      out.once = true;
    } else if (a === "--help" || a === "-h") {
      out.help = true;
    } else {
      throw new Error(`unknown argument ${a}`);
    }
  }
  return out;
}

/** Classify one gig's stage from its row and its latest attempt. Pure: takes plain
 *  objects (`{ status } | null`), never the DB.
 *
 *  A gig reverts to `qualified` when its attempt FAILS (dispatch.ts / sync.ts move
 *  the gig back and the attempt to `failed`). We report that as `failed` so the
 *  driver benches it - a failed gig is a terminal DONE state for the operator to
 *  review, not something to re-dispatch on a loop. A `qualified` gig whose latest
 *  attempt is not a failure (none yet, or the operator discarded/revised a draft)
 *  is dispatchable. */
export function classifyStage(gig, latestAttempt) {
  if (!gig) return "missing";
  const att = latestAttempt?.status ?? null;
  switch (gig.status) {
    case "new":
      return "new";
    case "qualified":
      return att === "failed" ? "failed" : "qualified";
    case "dispatched":
      return att === "running" ? "running" : "dispatched";
    case "drafted":
      return "drafted";
    default:
      // suspect | in_review | sent | accepted | declined | withdrawn | expired | ...
      return "other";
  }
}

/** In-flight run count for the concurrency budget: gigs `dispatched` or `running`,
 *  plus one for a specialist hire that is still building (CONTROL: a hire build
 *  counts as a run). Pure. */
export function countInFlight(stages, { hireBuilding = false } = {}) {
  const gigs = stages.filter((s) => s === "dispatched" || s === "running").length;
  return gigs + (hireBuilding ? 1 : 0);
}

/** True once every gig in the set has reached a terminal stage (`drafted` or
 *  `failed`) - the pass prints DONE. Pure. */
export function isDone(stageById) {
  const vals = Object.values(stageById);
  return vals.length > 0 && vals.every((s) => s === "drafted" || s === "failed");
}

/** Parse one line of `operator-approvals.mjs list` output. That script prints each
 *  pending approval as:
 *
 *    "  appr_<id>  <action>  <persona> -> workspace '<name>', $<budget>  (by <k>, expires <t>)"
 *
 *  Returns { apprId, action, workspace } for an `appr_` line, else null. Pure. */
export function parseApprovalLine(line) {
  const m = /^\s*(appr_\S+)\s+(\S+)\s+(.*)$/.exec(String(line));
  if (!m) return null;
  const ws = /workspace '([^']*)'/.exec(m[3]);
  return { apprId: m[1], action: m[2], workspace: ws ? ws[1] : null };
}

/** The appr ids of pending `kp_hire_request` approvals filed for exactly
 *  `workspaceName` ('OSS bounties'). A hire for any other workspace (e.g.
 *  'Freelance') is NEVER returned - approving it would be the other process's. Pure. */
export function ossHireApprovalIds(listOutput, workspaceName = OSS_WORKSPACE_NAME) {
  const ids = [];
  for (const line of String(listOutput).split(/\r?\n/)) {
    const p = parseApprovalLine(line);
    if (p && p.action === "kp_hire_request" && p.workspace === workspaceName) ids.push(p.apprId);
  }
  return ids;
}

/** Counts per stage, in report order (stages with 0 omitted). Pure. */
export function tallyStages(stageById) {
  const counts = {};
  for (const s of Object.values(stageById)) counts[s] = (counts[s] ?? 0) + 1;
  return counts;
}

/** The one-line stage tally, e.g. "new=3 qualified=5 drafted=18 failed=1". Pure. */
export function formatTally(stageById) {
  const counts = tallyStages(stageById);
  return STAGES.filter((s) => counts[s]).map((s) => `${s}=${counts[s]}`).join(" ") || "(empty set)";
}

// ---------------------------------------------------------------------------
// I/O helpers (not unit-tested - they touch the filesystem / a child process)
// ---------------------------------------------------------------------------

function errMsg(e) {
  return e instanceof Error ? e.message : String(e);
}

function repoRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
}

/** Read the gig-id set (a JSON array of oss_bounty gig ids). */
function readSet(p) {
  const arr = JSON.parse(fs.readFileSync(p, "utf8"));
  if (!Array.isArray(arr)) throw new Error(`${p} is not a JSON array`);
  return arr.filter((x) => typeof x === "string" && x.length > 0);
}

/** Read the checkpoint (a cache + append-only log), or a fresh one if absent. */
function readState(p) {
  try {
    const s = JSON.parse(fs.readFileSync(p, "utf8"));
    if (s && typeof s === "object") return s;
  } catch {
    // absent or unreadable: a fresh checkpoint - the DB is the truth, this is a cache
  }
  return { specialistId: null, hiredAgentId: null, requestId: null, specialistStatus: null, stages: {}, events: [] };
}

function writeState(p, state) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(state, null, 2));
}

/** Lazily load the kp store (TypeScript). Only reached inside a real pass, under
 *  the alias loader - never during `node --test` of the pure helpers above. */
async function loadStore() {
  const root = repoRoot();
  const imp = (rel) => import(pathToFileURL(path.join(root, rel)).href);
  const [gigs, attempts, specialists, agents, specialist, qualify, project, dispatch, sync] = await Promise.all([
    imp("app/_lib/db/gigs.ts"),
    imp("app/_lib/db/gigs-attempts.ts"),
    imp("app/_lib/db/gigs-specialists.ts"),
    imp("app/_lib/db/agents.ts"),
    imp("app/_lib/gigs/specialist.ts"),
    imp("app/_lib/gigs/qualify.ts"),
    imp("app/_lib/gigs/project.ts"),
    imp("app/_lib/gigs/dispatch.ts"),
    imp("app/_lib/gigs/sync.ts"),
  ]);
  return {
    getGig: gigs.getGig,
    listGigAttemptsForGig: attempts.listGigAttemptsForGig,
    getGigSpecialist: specialists.getGigSpecialist,
    findGigSpecialistForArena: specialists.findGigSpecialistForArena,
    getHiredAgent: agents.getHiredAgent,
    ACTIVE_AGENT_STATUSES: agents.ACTIVE_AGENT_STATUSES,
    hireGigSpecialist: specialist.hireGigSpecialist,
    qualifyAndMatch: qualify.qualifyAndMatch,
    prepareGigProject: project.prepareGigProject,
    dispatchGigAttempt: dispatch.dispatchGigAttempt,
    syncGigAttempts: sync.syncGigAttempts,
  };
}

/** The latest attempt for a gig, or null. */
function latestAttempt(store, ws, gigId) {
  const list = store.listGigAttemptsForGig(ws, gigId);
  return list.length > 0 ? list[list.length - 1] : null;
}

/** Reconcile one gig's stage from the DB (never throws - a per-gig failure is logged
 *  and reported as `other` so the pass continues). */
function reconcileStage(store, ws, gigId, record) {
  try {
    const gig = store.getGig(ws, gigId);
    const att = gig ? latestAttempt(store, ws, gigId) : null;
    return classifyStage(gig, att);
  } catch (e) {
    record(`reconcile ${gigId} failed: ${errMsg(e)}`);
    return "other";
  }
}

/** Shell out to Personas' operator-approvals.mjs and approve every pending
 *  'OSS bounties' hire. Node builtins only, args passed as an array (no shell). A
 *  failure (Personas down) is logged and returns []; it never crashes the pass. */
function approveOssHires(personasDir, record) {
  const script = path.join(personasDir, "scripts", "operator-approvals.mjs");
  if (!fs.existsSync(script)) {
    record(`approvals: operator-approvals.mjs not found at ${script} - skipping`);
    return [];
  }
  let listOut;
  try {
    listOut = execFileSync(process.execPath, [script, "list"], { encoding: "utf8" });
  } catch (e) {
    record(`approvals: list failed (Personas unreachable?): ${errMsg(e)}`);
    return [];
  }
  const ids = ossHireApprovalIds(listOut, OSS_WORKSPACE_NAME);
  if (ids.length === 0) {
    record("approvals: no pending 'OSS bounties' hire to approve");
    return [];
  }
  const approved = [];
  for (const id of ids) {
    try {
      const out = execFileSync(process.execPath, [script, "approve", id, APPROVE_NOTE], { encoding: "utf8" });
      approved.push(id);
      record(`approved ${id}: ${out.trim()}`);
    } catch (e) {
      record(`approve ${id} failed: ${errMsg(e)}`);
    }
  }
  return approved;
}

// ---------------------------------------------------------------------------
// One pass
// ---------------------------------------------------------------------------

/**
 * Run exactly one pass. Always resolves to EXIT.OK - a pass never throws; each
 * gig's work is wrapped so one failure does not abort the rest. Writes the
 * checkpoint and prints the summary before returning.
 */
export async function runPass(opts, io = {}) {
  const log = io.log ?? console.log;
  const ws = io.ws ?? process.env.GIG_WS ?? "workspace";
  const personasDir = opts.personasDir || process.env.PERSONAS_DIR || DEFAULT_PERSONAS_DIR;

  const prev = readState(opts.state);
  const passEvents = [];
  const record = (msg) => {
    passEvents.push({ at: new Date().toISOString(), msg });
    log(msg);
  };

  let set;
  try {
    set = readSet(opts.set);
  } catch (e) {
    // No set = nothing to do this pass; report it and exit cleanly (retry next pass).
    record(`set unreadable at ${opts.set}: ${errMsg(e)}`);
    persist(opts.state, prev, passEvents, {}, { specialistId: null, hiredAgentId: null, requestId: null, specialistStatus: null });
    return EXIT.OK;
  }

  const store = await loadStore();

  const approvedThisPass = [];
  const qualifiedThisPass = [];
  const dispatchedThisPass = [];

  // 1. Reconcile ------------------------------------------------------------
  const stageById = {};
  for (const id of set) stageById[id] = reconcileStage(store, ws, id, record);

  // 2. Specialist -----------------------------------------------------------
  // Truth is the DB: prefer the state-file id, fall back to any oss_bounty
  // specialist in the workspace. Re-hire only when there is none, or its hire is
  // dead (hireGigSpecialist itself reuses a LIVE hire and mints a new one otherwise).
  let specialist = null;
  try {
    if (prev.specialistId) specialist = store.getGigSpecialist(ws, prev.specialistId);
    if (!specialist) specialist = store.findGigSpecialistForArena(ws, ARENA, opts.niche);
  } catch (e) {
    record(`specialist lookup failed: ${errMsg(e)}`);
  }
  let agent = null;
  try {
    if (specialist) agent = store.getHiredAgent(specialist.hiredAgentId, ws);
  } catch (e) {
    record(`hired-agent read failed: ${errMsg(e)}`);
  }
  const isLive = agent && store.ACTIVE_AGENT_STATUSES.includes(agent.status);

  if (!specialist || !isLive) {
    let res;
    try {
      res = await store.hireGigSpecialist(ws, { arena: ARENA, niche: opts.niche });
    } catch (e) {
      // Personas unreachable during the hire: print and exit 0, retry next pass.
      record(`hire threw (Personas unreachable?): ${errMsg(e)} - retry next pass`);
      persist(opts.state, prev, passEvents, stageById, {
        specialistId: specialist?.id ?? prev.specialistId ?? null,
        hiredAgentId: specialist?.hiredAgentId ?? prev.hiredAgentId ?? null,
        requestId: prev.requestId ?? null,
        specialistStatus: agent?.status ?? null,
      });
      summary(log, { ws, set, opts, agent, stageById, hireBuilding: true, approvedThisPass, qualifiedThisPass, dispatchedThisPass });
      return EXIT.OK;
    }
    if (!res || !res.ok) {
      record(`hire refused: ${res?.code ?? "?"} ${res?.error ?? ""}`.trim());
      persist(opts.state, prev, passEvents, stageById, {
        specialistId: specialist?.id ?? prev.specialistId ?? null,
        hiredAgentId: res?.hiredAgentId ?? prev.hiredAgentId ?? null,
        requestId: prev.requestId ?? null,
        specialistStatus: null,
      });
      summary(log, { ws, set, opts, agent: null, stageById, hireBuilding: false, approvedThisPass, qualifiedThisPass, dispatchedThisPass });
      return EXIT.OK;
    }
    specialist = res.specialist;
    record(`specialist ${res.reused ? "reused" : "hired new"}: ${res.specialist.id} hiredAgent=${res.hiredAgentId} requestId=${res.requestId ?? "-"}`);
    prev.requestId = res.requestId ?? prev.requestId ?? null;
    try {
      agent = store.getHiredAgent(res.hiredAgentId, ws);
    } catch (e) {
      record(`hired-agent read after hire failed: ${errMsg(e)}`);
    }
  }

  const hireStatus = agent?.status ?? null;
  let hireBuilding = false;
  let canDispatch = false;
  if (hireStatus === "active") {
    canDispatch = true;
  } else if (hireStatus === "pending_approval") {
    hireBuilding = true;
    record("specialist hire is pending_approval - approving the 'OSS bounties' hire");
    approvedThisPass.push(...approveOssHires(personasDir, record));
    record("persona building - skipping dispatch this pass");
  } else if (hireStatus === "onboarding") {
    hireBuilding = true;
    record("persona building (onboarding) - skipping dispatch this pass");
  } else if (HIRE_BUILDING_STATUSES.includes(hireStatus)) {
    hireBuilding = true;
    record(`specialist hire is ${hireStatus} (building) - skipping dispatch this pass`);
  } else if (hireStatus === null) {
    record("no hired agent for the specialist - skipping dispatch this pass");
  } else {
    // rejected | failed | retired - a dead hire; the operator must intervene.
    record(`specialist hire is ${hireStatus} (not runnable) - skipping dispatch this pass`);
  }

  // 3. Qualify --------------------------------------------------------------
  for (const id of set) {
    if (stageById[id] !== "new") continue;
    try {
      const res = store.qualifyAndMatch(ws, id);
      if (res.ok) {
        stageById[id] = reconcileStage(store, ws, id, record);
        if (res.moved) {
          qualifiedThisPass.push(id);
          record(`qualify ${id}: moved new->qualified (score ${res.qualification?.score ?? "?"})`);
        } else {
          record(`qualify ${id}: stayed new (score ${res.qualification?.score ?? "?"})`);
        }
      } else {
        record(`qualify ${id}: ${res.reason}`);
      }
    } catch (e) {
      record(`qualify ${id} threw: ${errMsg(e)}`);
    }
  }

  // 4. Count in-flight ------------------------------------------------------
  let inFlight = countInFlight(Object.values(stageById), { hireBuilding });

  // 5. Dispatch -------------------------------------------------------------
  if (canDispatch) {
    for (const id of set) {
      if (inFlight >= opts.maxInflight) break;
      if (stageById[id] !== "qualified") continue;
      try {
        const prep = await store.prepareGigProject(ws, id);
        if (!prep.ok) {
          record(`dispatch ${id}: prepare failed ${prep.code}${prep.reason ? " " + prep.reason : ""}`);
          continue;
        }
        const d = await store.dispatchGigAttempt(ws, id, {});
        if (d.ok) {
          stageById[id] = "dispatched";
          dispatchedThisPass.push(id);
          inFlight++;
          record(`dispatched ${id}: attempt ${d.attempt?.id ?? "?"} exec ${d.executionId ?? "?"}`);
        } else {
          // GIG_SUSPECT | GIG_NOT_DISPATCHABLE | GIG_SPECIALIST_NOT_READY |
          // GIG_WORKSPACE_FAILED | GIG_DISPATCH_FAILED - log the code, move on.
          const detail = d.reason ?? d.detail ?? "";
          record(`dispatch ${id}: ${d.code}${detail ? " " + detail : ""}`);
          stageById[id] = reconcileStage(store, ws, id, record);
        }
      } catch (e) {
        record(`dispatch ${id} threw: ${errMsg(e)}`);
      }
    }
  }

  // 6. Sync -----------------------------------------------------------------
  try {
    const s = await store.syncGigAttempts(ws);
    record(
      `sync: checked=${s.checked} running=${s.running} drafted=${s.drafted} failed=${s.failed} unchanged=${s.unchanged} unreachable=${s.unreachable} stale=${s.stale}`
    );
  } catch (e) {
    record(`sync threw: ${errMsg(e)}`);
  }
  // Re-reconcile after sync so the checkpoint + summary reflect the landed state.
  for (const id of set) stageById[id] = reconcileStage(store, ws, id, record);

  // 7. Checkpoint + summary -------------------------------------------------
  hireBuilding = hireStatus !== null && hireStatus !== "active" && HIRE_BUILDING_STATUSES.includes(hireStatus);
  persist(opts.state, prev, passEvents, stageById, {
    specialistId: specialist?.id ?? prev.specialistId ?? null,
    hiredAgentId: specialist?.hiredAgentId ?? prev.hiredAgentId ?? null,
    requestId: prev.requestId ?? null,
    specialistStatus: hireStatus,
  });
  summary(log, { ws, set, opts, agent, stageById, hireBuilding, approvedThisPass, qualifiedThisPass, dispatchedThisPass });
  return EXIT.OK;
}

/** Write the checkpoint: the cache fields plus an APPEND-ONLY event log (this
 *  pass's events are appended to the prior ones, never rewritten). */
function persist(statePath, prev, passEvents, stageById, cache) {
  const state = {
    ...cache,
    updatedAt: new Date().toISOString(),
    stages: stageById,
    events: [...(Array.isArray(prev.events) ? prev.events : []), ...passEvents],
  };
  try {
    writeState(statePath, state);
  } catch (e) {
    // The state file is a cache/log; failing to write it must not fail the pass.
    (console.error || console.log)(`state write failed at ${statePath}: ${errMsg(e)}`);
  }
}

/** The one-screen pass summary. */
function summary(log, { ws, set, opts, agent, stageById, hireBuilding, approvedThisPass, qualifiedThisPass, dispatchedThisPass }) {
  const inFlight = countInFlight(Object.values(stageById), { hireBuilding });
  const arr = (a) => (a.length ? a.join(", ") : "-");
  log("");
  log(`=== train-tick pass @ ${new Date().toISOString()} ===`);
  log(`set: ${set.length} gigs   ws: ${ws}   arena: ${ARENA}   niche: "${opts.niche}"`);
  log(`specialist: ${agent ? `${agent.id} status=${agent.status}` : "(none)"}   in-flight: ${inFlight}/${opts.maxInflight}${hireBuilding ? " (hire building counts as 1)" : ""}`);
  log(`stages: ${formatTally(stageById)}`);
  log(`this pass: approved=[${arr(approvedThisPass)}]  qualified=[${arr(qualifiedThisPass)}]  dispatched=[${arr(dispatchedThisPass)}]`);
  if (isDone(stageById)) log("DONE - every gig is drafted or failed (awaiting the operator's manual review).");
  log("");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function main(argv, io = {}) {
  const log = io.log ?? console.log;
  const err = io.err ?? console.error;
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (e) {
    err(errMsg(e));
    err(HELP);
    return EXIT.USAGE;
  }
  if (opts.help) {
    log(HELP);
    return EXIT.OK;
  }
  return runPass(opts, io);
}

// Entry point: run only when invoked directly, not when imported by the test.
const invokedDirectly =
  process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (invokedDirectly) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
