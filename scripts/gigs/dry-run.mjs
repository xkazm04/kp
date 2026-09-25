#!/usr/bin/env node
/**
 * dry-run - drive kp's Gigs pipeline end to end over HTTP, substituting the
 * operator's UI clicks, up to (and stopping at) a drafted deliverable on the
 * review desk. It proves the pipeline lands work for review; it NEVER sends.
 *
 * THE HUMAN-SEND GATE STAYS. This orchestrator has no path to the attempt
 * `mark_sent` action, and it never submits, bids or posts anything. Its last act
 * is to print the drafted deliverable and stop. The operator is the only actor
 * that submits, in the Gigs tab, under their own account (docs/features/gigs).
 *
 * PERSONAS IS NOT HEADLESS. The Personas management API (pairing, project
 * creation, hire, execute) exists ONLY while the Tauri desktop app runs; the
 * `personas-daemon` does not serve it. So the preflight DETECTS whether kp's
 * bridge is paired and, when it is not, prints the exact command to start the
 * desktop app and exits 3 - it does NOT launch it silently. `--start-personas`
 * spawns it, but only when explicitly passed, and only after printing the
 * security note that PERSONAS_HEADLESS_BRIDGE=1 lets any local origin mint a key.
 *
 * kp auth: in open dev mode (KP_OPERATOR_PASSWORD unset) the routes are open, so
 * this works locally with no cookie. On a passworded deploy set KP_SESSION_COOKIE
 * to a session cookie; it rides every request as Cookie.
 *
 * Sequence (all HTTP against KP_BASE_URL / --kp, default http://localhost:3000):
 *   1. preflight  GET  /api/agents/bridge
 *   2. pair       POST /api/agents/pair   (start -> claim, only when unpaired)
 *   3. prepare    POST /api/gigs/<gig>/workspace
 *   4. hire       POST /api/gigs/specialists  then poll GET /api/gigs/specialists
 *   5. dispatch   POST /api/gigs/<gig>/dispatch
 *   6. pull       loop POST /api/gigs/sync + GET /api/gigs/<gig> until drafted|failed
 *   7. stop       print the deliverable; nothing is sent.
 *
 * Exit codes: 0 success (or a partial --*-only scope completed), 1 an
 * operational failure (kp unreachable, a refused/failed dispatch, a timeout,
 * a failed run), 2 a usage error, 3 Personas is unreachable/unpaired and could
 * not be paired. Node builtins only.
 */

import { spawn } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const DEFAULT_GIG = "gig-mug1865t-veryo9";
export const DEFAULT_KP = "http://localhost:3000";
export const DEFAULT_ARENA = "oss_bounty";
export const DEFAULT_NICHE = "frontend / CSS";
export const DEFAULT_TIMEOUT_S = 300;
export const SESSION_COOKIE_ENV = "KP_SESSION_COOKIE";

export const EXIT = { OK: 0, FAIL: 1, USAGE: 2, PREFLIGHT: 3 };

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested)
// ---------------------------------------------------------------------------

export const HELP = `usage: node scripts/gigs/dry-run.mjs [options]

Drive kp's Gigs pipeline over HTTP up to a drafted deliverable. Never sends.

  --gig <id>          the gig to run (default ${DEFAULT_GIG})
  --kp <url>          the kp base URL (default ${DEFAULT_KP}, or KP_BASE_URL)
  --arena <a>         specialist arena to hire (default ${DEFAULT_ARENA})
  --niche <n>         specialist niche to hire (default "${DEFAULT_NICHE}")
  --start-personas    spawn the Personas desktop app when unpaired (prints a
                      security note first; needs PERSONAS_DESKTOP_EXE)
  --pair-only         stop after preflight + pairing (steps 1-2)
  --prepare-only      stop after preparing the workspace (steps 1-3)
  --no-dispatch       stop after hiring the specialist (steps 1-4)
  --timeout-s <n>     seconds to wait for pairing / a specialist / a draft
                      (default ${DEFAULT_TIMEOUT_S})
  --help, -h          this text

Auth: open dev mode needs no cookie; a passworded deploy needs ${SESSION_COOKIE_ENV}.`;

/** Parse argv into the run's options. Throws on an unknown flag or a missing value. */
export function parseArgs(argv) {
  const out = {
    gig: DEFAULT_GIG,
    kp: null,
    arena: DEFAULT_ARENA,
    niche: DEFAULT_NICHE,
    startPersonas: false,
    pairOnly: false,
    prepareOnly: false,
    noDispatch: false,
    timeoutS: DEFAULT_TIMEOUT_S,
    help: false,
  };
  const takesValue = { "--gig": "gig", "--kp": "kp", "--arena": "arena", "--niche": "niche" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a in takesValue) {
      const v = argv[i + 1];
      if (typeof v !== "string" || v.startsWith("--")) throw new Error(`${a} needs a value`);
      out[takesValue[a]] = v;
      i++;
    } else if (a === "--timeout-s") {
      const v = argv[i + 1];
      const n = Number(v);
      if (!Number.isFinite(n) || n <= 0) throw new Error("--timeout-s needs a positive number of seconds");
      out.timeoutS = Math.floor(n);
      i++;
    } else if (a === "--start-personas") out.startPersonas = true;
    else if (a === "--pair-only") out.pairOnly = true;
    else if (a === "--prepare-only") out.prepareOnly = true;
    else if (a === "--no-dispatch") out.noDispatch = true;
    else if (a === "--help" || a === "-h") out.help = true;
    else throw new Error(`unknown argument ${a}`);
  }
  return out;
}

/** The kp base URL from a flag, then KP_BASE_URL, then the default. */
export function resolveBaseUrl(flag, env = process.env) {
  const raw = flag || env.KP_BASE_URL || DEFAULT_KP;
  return String(raw).replace(/\/+$/, "");
}

/** The exact command block to print when Personas must be started by hand. */
export function personasStartLines() {
  return [
    "Personas is not paired. Its management API only runs while the desktop app is open.",
    "Start it from the personas repo root (Windows):",
    "",
    "    set PERSONAS_HEADLESS_BRIDGE=1 && <path to>\\personas-desktop.exe",
    "",
    "  (headless-bridge WEAKENS pairing: any local origin can mint a real key.",
    "   Omit the env var to pair by approving the request in the Personas UI.)",
    "  Dev alternative, from the personas repo root: npm run tauri dev",
    "",
    "Then re-run this script, or pass --start-personas to spawn it (needs PERSONAS_DESKTOP_EXE).",
  ];
}

/** The one-line security note printed before --start-personas spawns anything. */
export const HEADLESS_SECURITY_NOTE =
  "SECURITY: spawning Personas with PERSONAS_HEADLESS_BRIDGE=1 lets ANY local origin mint a real bridge key without human approval.";

/** The matching specialist in a GET /api/gigs/specialists list, by arena + niche. */
export function findSpecialist(list, { arena, niche }) {
  if (!Array.isArray(list)) return null;
  return (
    list.find((s) => s?.spec?.arena === arena && s?.spec?.niche === niche) ??
    // A hire may normalise the niche; fall back to arena-only when there is one.
    list.find((s) => s?.spec?.arena === arena) ??
    null
  );
}

/** Whether a specialist's hired agent is ready to receive a dispatch: it has a
 *  Personas persona id and is not in a terminal-bad state. */
export function specialistHireReady(specialist) {
  const hire = specialist?.hire;
  if (!hire || !hire.personaId) return { ready: false, reason: hire ? "no_persona_id" : "no_hire" };
  const dead = ["rejected", "failed", "retired"];
  if (dead.includes(hire.status)) return { ready: false, reason: hire.status };
  return { ready: true, reason: hire.status };
}

/** The pull-loop state machine: given a GET /api/gigs/<id> view (and the attempt
 *  we dispatched, when known), what phase is the run in? */
export function pullState(gigView, attemptId = null) {
  const attempts = Array.isArray(gigView?.attempts) ? gigView.attempts : [];
  const target = attemptId ? attempts.find((a) => a?.id === attemptId) : attempts[attempts.length - 1];
  if (!target) return { done: false, ok: false, phase: "none", attempt: null };
  if (target.status === "drafted") return { done: true, ok: true, phase: "drafted", attempt: target };
  if (target.status === "failed") return { done: true, ok: false, phase: "failed", attempt: target };
  // dispatched | running | anything else the operator has not resolved yet
  return { done: false, ok: false, phase: "waiting", attempt: target };
}

/** One evidence row -> a line. `passed` is tri-state: true/false/null; null is
 *  UNVERIFIED ("ran, no pass/fail meaning"), NEVER rendered as a failure. */
export function renderEvidenceLine(ev) {
  const mark = ev?.passed === true ? "PASS" : ev?.passed === false ? "FAIL" : "UNVERIFIED";
  const kind = ev?.kind ?? "evidence";
  const cmd = ev?.command ? `\`${ev.command}\` ` : "";
  const result = typeof ev?.result === "string" ? ev.result : "";
  return `    [${mark}] ${kind}: ${cmd}${result}`.trimEnd();
}

/** The compact deliverable / failure view printed at the end. Pure: returns lines. */
export function formatDeliverable(attempt, { folder = null } = {}) {
  const lines = [];
  if (!attempt) {
    lines.push("No attempt to show.");
    return lines;
  }
  if (attempt.status === "failed" || !attempt.deliverable) {
    lines.push(`Run FAILED (attempt ${attempt.id}).`);
    lines.push(`  reason: ${attempt.fallbackReason ?? "unknown"}`);
    if (attempt.costUsd != null) lines.push(`  metered cost: $${attempt.costUsd}`);
    if (folder) lines.push(`  gig folder: ${folder}`);
    return lines;
  }
  const d = attempt.deliverable;
  lines.push(`Deliverable (attempt ${attempt.id}):`);
  lines.push(`  summary: ${d.summary}`);
  if (Array.isArray(d.artifacts) && d.artifacts.length > 0) {
    lines.push("  artifacts:");
    for (const a of d.artifacts) lines.push(`    - ${a.kind}: ${a.title ?? ""} (${a.ref})`.replace("  ()", ""));
  }
  if (Array.isArray(d.evidence) && d.evidence.length > 0) {
    lines.push("  evidence:");
    for (const ev of d.evidence) lines.push(renderEvidenceLine(ev));
  }
  lines.push(`  disclosure: ${d.disclosure}`);
  lines.push(`  confidence: ${d.confidence}`);
  if (attempt.costUsd != null) lines.push(`  metered cost: $${attempt.costUsd}`);
  if (folder) lines.push(`  gig folder: ${folder}`);
  return lines;
}

// ---------------------------------------------------------------------------
// HTTP (an injectable fetch, so the tests never touch the network)
// ---------------------------------------------------------------------------

function kpHeaders(env) {
  const h = { "Content-Type": "application/json" };
  const cookie = env[SESSION_COOKIE_ENV];
  if (cookie) h.Cookie = cookie;
  return h;
}

/** One JSON call. Returns { status, ok, json } and never throws on a non-2xx;
 *  a transport failure (kp down) throws, which the caller turns into an exit. */
export async function kpJson(deps, method, routePath, body) {
  const res = await deps.fetch(new URL(routePath, deps.baseUrl), {
    method,
    headers: kpHeaders(deps.env),
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // A non-JSON body (an HTML error page from a fronting proxy) is not fatal here;
    // the caller decides on the status.
    json = null;
  }
  return { status: res.status, ok: res.ok, json };
}

export async function getBridge(deps) {
  const r = await kpJson(deps, "GET", "/api/agents/bridge");
  if (!r.ok) throw new Error(`GET /api/agents/bridge answered ${r.status}`);
  return r.json?.bridge ?? null;
}

// ---------------------------------------------------------------------------
// Spawning Personas (never silent; not unit-tested - it uses child_process)
// ---------------------------------------------------------------------------

function spawnPersonas(env, log, err) {
  const exe = env.PERSONAS_DESKTOP_EXE;
  if (!exe) {
    err("--start-personas needs PERSONAS_DESKTOP_EXE set to the desktop app's path.");
    return false;
  }
  const childEnv = { ...env };
  // Only weaken pairing when the caller explicitly opted in via the env var; the
  // security note above told them what that means.
  if (env.PERSONAS_HEADLESS_BRIDGE === "1") childEnv.PERSONAS_HEADLESS_BRIDGE = "1";
  log(`Spawning Personas: ${exe}`);
  try {
    const child = spawn(exe, [], { env: childEnv, detached: true, stdio: "ignore" });
    child.unref();
    return true;
  } catch (e) {
    err(`Could not spawn Personas: ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }
}

const realSleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function main(argv, { env = process.env, log = console.log, err = console.error, fetch = globalThis.fetch, sleep = realSleep } = {}) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (e) {
    err(e instanceof Error ? e.message : String(e));
    err(HELP);
    return EXIT.USAGE;
  }
  if (args.help) {
    log(HELP);
    return EXIT.OK;
  }

  const baseUrl = resolveBaseUrl(args.kp, env);
  const deps = { baseUrl, fetch, env };
  const deadlineAt = Date.now() + args.timeoutS * 1000;
  const timeLeft = () => deadlineAt - Date.now();

  log(`kp: ${baseUrl}   gig: ${args.gig}`);

  // 1. Preflight -----------------------------------------------------------
  let bridge;
  try {
    bridge = await getBridge(deps);
  } catch (e) {
    err(`kp is not reachable at ${baseUrl}: ${e instanceof Error ? e.message : String(e)}`);
    err("Start kp with `npm run dev` (open dev mode) and re-run.");
    return EXIT.FAIL;
  }
  log(`bridge: baseUrl=${bridge?.baseUrl ?? "?"} paired=${bridge?.paired === true}`);

  if (bridge?.paired !== true) {
    for (const line of personasStartLines()) log(line);
    if (!args.startPersonas) {
      err("Personas is not paired. Start it (above) and re-run, or pass --start-personas.");
      return EXIT.PREFLIGHT;
    }
    // 2. Pair (only reached with --start-personas) -------------------------
    log(HEADLESS_SECURITY_NOTE);
    if (!spawnPersonas(env, log, err)) return EXIT.PREFLIGHT;
    const paired = await pairLoop(deps, { log, err, sleep, timeLeft });
    if (!paired) {
      err(
        "Personas did not auto-approve - start it with PERSONAS_HEADLESS_BRIDGE=1 or approve the pairing in its UI."
      );
      return EXIT.PREFLIGHT;
    }
    log("Paired with Personas.");
  }

  if (args.pairOnly) {
    log("Paired. Stopping (--pair-only).");
    return EXIT.OK;
  }

  // 3. Prepare the gig's workspace / Personas project ----------------------
  const prep = await kpJson(deps, "POST", `/api/gigs/${encodeURIComponent(args.gig)}/workspace`);
  if (!prep.ok) {
    err(`prepare workspace failed: ${prep.status} ${prep.json?.code ?? ""} ${JSON.stringify(prep.json?.detail ?? "")}`);
    return EXIT.FAIL;
  }
  const folder = prep.json?.gig?.workdir ?? null;
  const linked = prep.json?.personas?.linked === true;
  log(`workspace: folder=${folder ?? "?"}  personas.linked=${linked}${linked ? "" : `  reason=${prep.json?.personas?.reason ?? "?"}`}`);

  if (args.prepareOnly) {
    log("Workspace prepared. Stopping (--prepare-only).");
    return EXIT.OK;
  }

  // 4. Hire the specialist -------------------------------------------------
  const hire = await kpJson(deps, "POST", "/api/gigs/specialists", { arena: args.arena, niche: args.niche });
  if (hire.status !== 200 && hire.status !== 201) {
    err(`hire specialist failed: ${hire.status} ${hire.json?.code ?? hire.json?.error ?? ""}`);
    return EXIT.FAIL;
  }
  log(`specialist: ${hire.json?.reused ? "reused existing" : "hired new"} (arena=${args.arena} niche="${args.niche}")`);
  const ready = await specialistLoop(deps, args, { log, err, sleep, timeLeft });
  if (!ready) {
    err("The specialist's Personas persona did not become ready in time.");
    return EXIT.FAIL;
  }

  if (args.noDispatch) {
    log("Specialist ready. Stopping (--no-dispatch).");
    return EXIT.OK;
  }

  // 5. Dispatch ------------------------------------------------------------
  const dispatch = await kpJson(deps, "POST", `/api/gigs/${encodeURIComponent(args.gig)}/dispatch`, {});
  if (!dispatch.ok) {
    err(`dispatch failed: ${dispatch.status} ${dispatch.json?.code ?? ""} ${JSON.stringify(dispatch.json?.reason ?? dispatch.json?.detail ?? "")}`);
    return EXIT.FAIL;
  }
  const attemptId = dispatch.json?.attempt?.id ?? null;
  log(`dispatched: attempt=${attemptId ?? "?"} execution=${dispatch.json?.executionId ?? "?"}`);

  // 6. Pull the deliverable ------------------------------------------------
  const final = await pullLoop(deps, args, attemptId, { log, err, sleep, timeLeft });
  if (final.phase === "timeout") {
    err(`Timed out after ${args.timeoutS}s waiting for the deliverable (last phase: ${final.last}).`);
    return EXIT.FAIL;
  }

  // 7. Stop ----------------------------------------------------------------
  log("");
  for (const line of formatDeliverable(final.attempt, { folder })) log(line);
  log("");
  if (final.phase === "failed") {
    err("The run failed - no deliverable to review.");
    return EXIT.FAIL;
  }
  log("Drafted and on the review desk. Nothing was sent. Review/approve in the Gigs tab; the operator is the only actor that submits.");
  return EXIT.OK;
}

async function pairLoop(deps, { log, err, sleep, timeLeft }) {
  const start = await kpJson(deps, "POST", "/api/agents/pair", { phase: "start" });
  if (!start.ok || typeof start.json?.nonce !== "string") {
    err(`pair start failed: ${start.status} ${start.json?.code ?? start.json?.error ?? ""}`);
    return false;
  }
  const nonce = start.json.nonce;
  while (timeLeft() > 0) {
    const claim = await kpJson(deps, "POST", "/api/agents/pair", { phase: "claim", nonce });
    if (claim.ok && claim.json?.paired === true) return true;
    log("pairing: waiting for approval...");
    if (timeLeft() <= 2000) break;
    await sleep(2000);
  }
  return false;
}

async function specialistLoop(deps, args, { log, err, sleep, timeLeft }) {
  while (timeLeft() > 0) {
    const list = await kpJson(deps, "GET", "/api/gigs/specialists");
    if (!list.ok) {
      err(`list specialists failed: ${list.status}`);
      return false;
    }
    const found = findSpecialist(list.json?.specialists, args);
    const state = specialistHireReady(found);
    if (state.ready) return true;
    if (["rejected", "failed", "retired"].includes(state.reason)) {
      err(`the specialist's hire is ${state.reason}`);
      return false;
    }
    log(`specialist: not ready yet (${state.reason})`);
    if (timeLeft() <= 2000) break;
    await sleep(2000);
  }
  return false;
}

async function pullLoop(deps, args, attemptId, { log, err, sleep, timeLeft }) {
  let last = "waiting";
  while (timeLeft() > 0) {
    await kpJson(deps, "POST", "/api/gigs/sync", {});
    const view = await kpJson(deps, "GET", `/api/gigs/${encodeURIComponent(args.gig)}`);
    if (!view.ok) {
      err(`get gig failed: ${view.status}`);
      return { phase: "timeout", last: `get ${view.status}`, attempt: null };
    }
    const state = pullState(view.json, attemptId);
    last = state.phase;
    if (state.done) return { phase: state.phase, attempt: state.attempt };
    log(`pull: ${state.phase}...`);
    if (timeLeft() <= 3000) break;
    await sleep(3000);
  }
  return { phase: "timeout", last, attempt: null };
}

// Entry point: run only when invoked directly, not when imported by the test.
const invokedDirectly =
  process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (invokedDirectly) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
