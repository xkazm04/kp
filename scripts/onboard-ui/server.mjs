#!/usr/bin/env node
/**
 * kp installer wizard — a local browser face over the `/onboarding` skill.
 *
 * The engine is a headless Claude Code CLI session driven over the stream-json
 * control protocol (see PROTOCOL.md, which records the wire shapes this file
 * depends on). It runs on the operator's own subscription login: no API key is
 * read, and every ANTHROPIC_*_KEY is stripped from the child env.
 *
 * Zero npm dependencies by design — this is the FIRST thing a fresh clone runs,
 * possibly before `npm install`.
 *
 * Security posture: binds 127.0.0.1 only and every mutating request must carry
 * the per-run token printed at startup. This process approves shell commands and
 * writes .env.local, so an unauthenticated local port would be a real hole.
 * Static files (the page and its assets) are served token-free — they are the
 * door, not the keys.
 */
import { createServer } from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync, existsSync, writeFileSync, appendFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");
// KP_ONBOARD_ENV_FILE exists so the merge path can be exercised against a
// throwaway file; the wizard itself always writes the repo's own .env.local.
const ENV_FILE = process.env.KP_ONBOARD_ENV_FILE
  ? path.resolve(process.env.KP_ONBOARD_ENV_FILE)
  : path.join(REPO_ROOT, ".env.local");
const ENV_BASENAME = path.basename(ENV_FILE);
const BASE_PORT = 4655;
const TOKEN = randomBytes(24).toString("hex");

/** Test-only: pretend boot verify already reported this port for the app proxy. */
const APP_PORT_OVERRIDE = Number(process.env.KP_ONBOARD_APP_PORT) || null;

/* ------------------------------------------------------------------ *
 * Tool policy
 * ------------------------------------------------------------------ */

/** Read-only tools the host approves without bothering the operator. */
const AUTO_ALLOW = new Set([
  "Read", "Glob", "Grep", "NotebookRead", "TodoWrite", "WebFetch", "WebSearch",
]);

/** Tools whose activity means "the agent is reading the project". */
const INSPECT_TOOLS = new Set(["Read", "Glob", "Grep", "NotebookRead"]);

/* ------------------------------------------------------------------ *
 * Env-file read guard.
 *
 * The host owns secret VALUES: it writes them and answers the agent with a
 * bare "<NAME> is set". That contract has one hole — Read/Grep/Glob are
 * auto-allowed, so nothing stopped the agent from simply opening .env.local
 * and pulling every value into model context. These tools are therefore denied
 * server-side whenever their path or pattern names the env file (or a bare
 * `.env`), silently: it is a host policy, not a decision for the operator.
 * `.env.example` carries no values and stays readable — it is the variable
 * catalogue the skill needs.
 * ------------------------------------------------------------------ */

const ENV_GUARD_TOOLS = new Set(["Read", "Grep", "Glob", "NotebookRead"]);
const ENV_GUARD_MESSAGE =
  "The host manages the env file — use the HOST INVENTORY in your instructions.";

/** Does this basename (possibly a glob) name a value-carrying env file? */
function isProtectedEnvName(raw) {
  const base = String(raw ?? "").trim().replace(/^["'`]+|["'`]+$/g, "");
  if (!base) return false;
  if (base === ".env.example") return false;
  if (base === ENV_BASENAME || base === ".env") return true;
  // Globs: `.env*`, `.env.*`, `.env.?ocal` — anything that would sweep the
  // real file in. `.env.example` is already excluded above, and a glob that
  // matches it also matches the real one, so denying is correct.
  return /^\.env(\.[A-Za-z0-9_*?[\]-]+)?[*?]?$/.test(base) && base !== ".env.example";
}

/** Every path-ish token in a tool input that could resolve to the env file. */
function targetsEnvFile(toolName, input) {
  if (!ENV_GUARD_TOOLS.has(toolName)) return false;
  const candidates = [
    input?.file_path, input?.path, input?.notebook_path, input?.pattern, input?.glob,
  ];
  for (const candidate of candidates) {
    if (typeof candidate !== "string" || !candidate) continue;
    const normalized = candidate.replace(/\\/g, "/");
    for (const token of normalized.split(/[\s,{}()|]+/)) {
      if (!token) continue;
      if (isProtectedEnvName(token.split("/").pop())) return true;
    }
  }
  return false;
}

/** Plain-language framing for the confirm card, per tool. */
function describeAsk(toolName, input) {
  // Bash on POSIX, PowerShell on Windows — both carry `command`.
  if (toolName === "Bash" || toolName === "PowerShell") {
    return { verb: "run a command", detail: String(input?.command ?? ""), note: input?.description ?? "" };
  }
  if (toolName === "Write") {
    return { verb: "create a file", detail: String(input?.file_path ?? ""), note: "" };
  }
  if (toolName === "Edit" || toolName === "MultiEdit" || toolName === "NotebookEdit") {
    return { verb: "edit a file", detail: String(input?.file_path ?? ""), note: "" };
  }
  return { verb: `use the ${toolName} tool`, detail: JSON.stringify(input ?? {}, null, 2), note: "" };
}

/** Stable key for "always allow this shape for the rest of the run". */
function shapeKey(toolName, input) {
  if (toolName === "Bash" || toolName === "PowerShell") return `${toolName}:${String(input?.command ?? "").trim()}`;
  if (input?.file_path) return `${toolName}:${input.file_path}`;
  return `${toolName}:${JSON.stringify(input ?? {})}`;
}

/* ------------------------------------------------------------------ *
 * Host markers — the agent's channel for structured events.
 *
 * The page is a status board, not a transcript, so the narration alone is not
 * enough: the host needs to know which phase is running, which probe passed and
 * which port the booted app answers on. The agent emits those as marker lines
 * inside its ordinary prose; the host strips the line and re-emits it as a
 * typed SSE event, so the operator never sees the syntax.
 * ------------------------------------------------------------------ */

const MARKER_RE = /^\s*\[\[wizard:([a-z]+)((?:\s+[a-z]+=(?:"[^"]*"|[^\s\]]+))*)\s*\]\]\s*$/;
/**
 * Phase ids used to be a closed set (welcome, mode, checks, capabilities, boot,
 * voice, done). Since v0.3 the recon-first run DECLARES its own steps with a
 * plan marker, so the host validates the SHAPE and lets the plan name the
 * vocabulary; `check` and single-group runs still emit the legacy ids, which
 * are slug-shaped and pass unchanged.
 */
const PHASE_ID_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
const PROBE_STATES = new Set(["ok", "fail", "warn", "running"]);
/** A plan rail longer than this is a runaway, not a journey. */
const MAX_PLAN_STEPS = 12;

function parseMarkerAttrs(raw) {
  const out = {};
  const re = /([a-z]+)=(?:"([^"]*)"|([^\s\]]+))/g;
  let m;
  while ((m = re.exec(raw))) out[m[1]] = m[2] !== undefined ? m[2] : m[3];
  return out;
}

/** `"assess:Looking around,done:Your install"` → `[{id,label}, …]`. */
function parsePlanSteps(raw) {
  const steps = [];
  const seen = new Set();
  for (const part of String(raw ?? "").split(",")) {
    const piece = part.trim();
    if (!piece) continue;
    const cut = piece.indexOf(":");
    const id = (cut >= 0 ? piece.slice(0, cut) : piece).trim().toLowerCase();
    const label = (cut >= 0 ? piece.slice(cut + 1) : piece).trim();
    if (!PHASE_ID_RE.test(id) || seen.has(id)) continue;
    seen.add(id);
    steps.push({ id, label: label || id });
    if (steps.length >= MAX_PLAN_STEPS) break;
  }
  return steps;
}

/* ------------------------------------------------------------------ *
 * Host inventory — the cheap facts the agent would otherwise have to go
 * looking for, and the ONE fact (which variables carry a value) it is not
 * allowed to look for at all.
 *
 * Names only, never values: the whole point is that the agent can reason about
 * which capability groups are already configured without a secret ever
 * entering model context.
 * ------------------------------------------------------------------ */

/** Names of variables in the env file that have a non-empty value. NEVER values. */
function envVarNames() {
  const names = [];
  const seen = new Set();
  for (const line of readEnvLines()) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(line);
    if (!m) continue;
    if (m[2].trim() === "") continue;
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    names.push(m[1]);
  }
  return names;
}

/** kp's conventional dev port — the fallback probe when no lock names one. */
const DEFAULT_DEV_PORT = 3000;

/** The port Next's dev-guard lock names, if it names one. */
function devLockPort() {
  const lockPath = path.join(REPO_ROOT, ".next", "dev", "lock");
  if (!existsSync(lockPath)) return { present: false, port: null };
  let raw = "";
  try { raw = readFileSync(lockPath, "utf8"); } catch { return { present: true, port: null }; }
  // The lock's shape is Next's, not ours, and it has changed across canaries:
  // accept JSON with a port field, a `port=`/`port:` line, or a bare number.
  let port = null;
  try {
    const parsed = JSON.parse(raw);
    for (const key of ["port", "appPort", "devPort"]) {
      const n = Number(parsed?.[key]);
      if (Number.isInteger(n) && n > 0 && n <= 65535) { port = n; break; }
    }
  } catch { /* not JSON — fall through to the text shapes */ }
  if (port === null) {
    const m = /port"?\s*[:=]\s*"?(\d{2,5})/i.exec(raw) || /^\s*(\d{2,5})\s*$/.exec(raw);
    const n = m ? Number(m[1]) : NaN;
    if (Number.isInteger(n) && n > 0 && n <= 65535) port = n;
  }
  return { present: true, port };
}

/** Does anything answer /api/health on that port? ~1s, never throws. */
async function probeHealth(port) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1200) });
    return { answered: true, status: r.status };
  } catch {
    return { answered: false, status: null };
  }
}

async function hostInventory() {
  const names = envVarNames();
  const lock = devLockPort();
  let devLine;
  if (lock.port === null) {
    // No lock, or a lock that names no port. One cheap probe of the default dev
    // port still separates "nothing is running" from "something is running that
    // dev-guard did not record" — a `next start`, or a dev server launched
    // outside the guard. Both are real states on a developer's machine and the
    // agent must not re-boot over either.
    const fallback = await probeHealth(DEFAULT_DEV_PORT);
    const lockNote = lock.present
      ? ".next/dev/lock exists but names no port"
      : "no .next/dev/lock";
    devLine = fallback.answered
      ? `${lockNote}, but SOMETHING answers /api/health on :${DEFAULT_DEV_PORT} (HTTP ${fallback.status}). Without the lock the host cannot tell whether that is THIS checkout or another app on this machine — confirm which before you treat it as running, and if it is this app do not boot or restart it.`
      : `${lockNote}, and nothing answered on :${DEFAULT_DEV_PORT} — treat this app as not running.`;
  } else {
    const health = await probeHealth(lock.port);
    devLine = health.answered
      ? `.next/dev/lock names port ${lock.port} and an app ANSWERS on :${lock.port} (GET /api/health -> ${health.status}). The app is already running: do not boot or restart it unless you changed something that needs a restart.`
      : `.next/dev/lock names port ${lock.port} but NOTHING answered there — a stale lock. Treat the app as not running.`;
  }
  return [
    "HOST INVENTORY — facts the installer host computed on this machine at startup.",
    "Treat these as ground truth and do not re-derive them.",
    "",
    `- Repository: ${REPO_ROOT}`,
    `- Env file (${ENV_FILE}): ${existsSync(ENV_FILE) ? "present" : "ABSENT — nothing has been configured here yet"}.`,
    `- Variables in the env file that hold a non-empty value — NAMES ONLY: ${names.length ? names.join(", ") : "(none)"}.`,
    "  Their VALUES are deliberately withheld. You must never open, read, grep or print the env",
    "  file: the host's permission layer denies it, and a value in your context is the exact leak",
    "  this wizard exists to prevent. A name in that list means the variable is SET; use that to",
    "  decide which capability groups are already configured, and verify them by their read-only",
    "  probes rather than by looking at the file.",
    `- .env.example: ${existsSync(path.join(REPO_ROOT, ".env.example")) ? "present (readable — it carries no values)" : "absent"}.`,
    `- node_modules/: ${existsSync(path.join(REPO_ROOT, "node_modules")) ? "present — dependencies are installed" : "ABSENT — npm install has not been run"}.`,
    `- data/kp.sqlite: ${existsSync(path.join(REPO_ROOT, "data", "kp.sqlite")) ? "present — this install has a database already" : "absent — a fresh database will self-seed the demo corpus on first boot"}.`,
    `- Dev server: ${devLine}`,
    "",
    "END HOST INVENTORY",
    "",
  ].join("\n");
}

/* ------------------------------------------------------------------ *
 * The wizard-mode preamble — the contract that keeps the fleet-shared
 * registry skill unedited.
 * ------------------------------------------------------------------ */

/** The recon-first flow, appended only for the default (`start`) run. */
function reconContract() {
  return [
    "7. RECON FIRST — this run does NOT open with the skill's step 0, and it does NOT assume a",
    "   fresh clone. Before you ask the operator anything:",
    "   a) ASSESS SILENTLY. Emit [[wizard:phase id=assess]] and work out where THIS install",
    "      actually is, from the HOST INVENTORY below plus the skill's read-only runtime probes,",
    "      plus — for every capability group whose variables the inventory shows as SET — that",
    "      group's check-mode verify probe. Ask NOTHING during assessment and spend nothing:",
    "      read-only commands only, no paid API calls. Keep emitting [[wizard:status …]] and",
    "      [[wizard:probe …]] as you go, and keep the narration to a couple of short lines.",
    "   b) CLASSIFY, THEN OFFER A JOURNEY. From what you found, classify this install as exactly",
    "      one of:",
    "        fresh    — dependencies and/or the env file are largely absent; a new clone.",
    "        addon    — a working install where some capability groups are simply unconfigured.",
    "        repair   — something that WAS configured now fails its verify. Name what, and why.",
    "        complete — everything configured verifies, and nothing obvious is missing.",
    "      Then ask ONE AskUserQuestion with header \"Journey\" whose options are GENERATED FROM",
    "      YOUR FINDINGS — concrete and honest, never a generic menu. Shapes that are right:",
    "      \"Add voice interviews (not configured)\", \"Fix CV analysis (GEMINI_API_KEY is set but",
    "      the analysis probe fails)\", \"Just show my capability matrix\", \"Run the full setup",
    "      anyway\". Each description says what the option will do and what it will ask of them.",
    "      On the `complete` journey go MATRIX-FIRST: put \"Just show my capability matrix\" first",
    "      and recommend it, and print the matrix immediately if it is chosen.",
    "      Ask the skill's install-mode question (developer laptop / team self-host / just",
    "      evaluating) ONLY on the `fresh` journey — on any other journey this machine has",
    "      already answered it, and asking again is the bug this contract exists to fix.",
    "   c) DECLARE THE PLAN. Immediately after the journey answer, emit ONE [[wizard:plan …]]",
    "      marker naming the steps this journey will really walk, ending in `done`, and use those",
    "      ids in every later [[wizard:phase]]. If the operator later picks a different group and",
    "      the journey changes, emit a fresh plan marker for the new steps.",
    "   d) THEN WALK IT. Everything after that follows the onboarding skill and the contracts",
    "      above: capability groups in batches, secret VALUES only ever through the host, the",
    "      voice phase only when spoken output is actually in scope, the capability matrix at the",
    "      end. Boot verify runs ONLY when the boot state is unknown or when something you",
    "      changed needs a restart — if the HOST INVENTORY says an app already answers on a port,",
    "      emit [[wizard:app port=N]] with that port and move on; do not restart it. On a",
    "      matrix-only journey, skip boot verify altogether.",
    "",
  ].join("\n");
}

function preamble(run) {
  return [
    "You are running as the ENGINE of the kp installer wizard: a local browser UI, not a terminal.",
    "A non-technical operator is watching a web page, not a transcript. Adapt as follows:",
    "",
    "1. SECRETS. When you need the VALUE of an API key, token or password, you must NOT ask the",
    "   operator to paste it into the conversation, and you must never run a command that would",
    "   print one. Instead call the AskUserQuestion tool with header \"Secret\" and a question whose",
    "   text names the EXACT environment variable, one variable per question — for example",
    "   \"Enter a value for GEMINI_API_KEY\" with options \"Paste the value\" and \"Skip for now\".",
    "   The host renders a masked field, writes the value into .env.local ITSELF, and answers you",
    "   with only \"<NAME> is set (written by the installer host — do not read or echo its value)\",",
    "   \"<NAME> kept\" or \"<NAME> skipped\". Treat that as the whole truth: never read the file back",
    "   to check, never echo, never confirm a prefix or a length.",
    "2. QUESTIONS. Every choice you need from the operator goes through AskUserQuestion, never as a",
    "   plain-text question in your narration — a question in prose will not be seen as answerable.",
    "3. NARRATION. Keep it short and in plain language: what you are doing and what it means for",
    "   them. Markdown tables render properly, so keep the probe table and the final capability",
    "   matrix as markdown tables.",
    "4. PERMISSIONS. Anything that runs a command or writes a file is confirmed by the operator in",
    "   the UI, so state plainly in your narration why a step is needed before you attempt it.",
    "5. HOST MARKERS. The page shows status cards, not a log, so emit these marker lines inside your",
    "   narration — each ON ITS OWN LINE, never inside a code fence or a table. The host strips the",
    "   line before anything is displayed, so the operator never sees the syntax.",
    "   - [[wizard:plan steps=\"assess:Looking around,voice:Voice interviews,done:Your install\"]]",
    "     declares the step plan for the journey you are about to walk: comma-separated id:Label",
    "     pairs, ids lowercase slugs, labels two or three plain words. The page draws it as the",
    "     progress rail, so name the steps you will ACTUALLY walk — no aspirational ones — and",
    "     always end with done. Emit a fresh plan marker if the journey changes mid-run.",
    "   - [[wizard:phase id=checks]] whenever you move to a new stage. Use the ids from your own",
    "     plan marker; when you have not declared a plan, use the fixed set: welcome, mode (the",
    "     install-mode question), checks (runtime prerequisites), capabilities (the capability",
    "     groups), boot (boot verify), voice (the spoken-output check), done (the final matrix).",
    "   - [[wizard:status text=\"Checking Python\"]] one short present-tense line whenever what you",
    "     are doing changes.",
    "   - [[wizard:probe name=\"node\" status=ok detail=\"v24.14\"]] once per runtime probe. status is",
    "     one of ok, fail, warn, running.",
    "   - [[wizard:app port=3000]] as soon as boot verify knows the LIVE port — read it off the",
    "     dev-guard banner, never assume 3000.",
    "   - [[wizard:matrix]] on the line immediately BEFORE the final capability matrix. Everything",
    "     after it in that message is taken as the matrix, so put nothing else after the table.",
    "6. SPOKEN-OUTPUT CHECK. When boot verify succeeds: emit [[wizard:app port=N]], then",
    "   [[wizard:phase id=voice]], then say in ONE plain sentence that the wizard now offers a quick",
    "   spoken-output check in the page, which the operator can also skip. Then STOP and wait: the",
    "   host runs that check itself and sends you a user message with the outcome (\"the operator",
    "   chose <provider>…\" or \"…skipped by the operator\"). Do not print the final capability matrix",
    "   before that message arrives, and do not ask about it with AskUserQuestion. If the app failed",
    "   to boot, skip the voice phase entirely and go straight to the matrix.",
    "",
    ...(isStartRun(run) ? [reconContract()] : []),
    "For everything else follow the onboarding skill exactly as written.",
    "",
  ].join("\n");
}

/** The recon-first default run. `full` is the pre-v0.3 name for the same thing. */
function isStartRun(run) {
  return run === "start" || run === "full";
}

function invocationFor(run) {
  if (isStartRun(run)) return "/onboarding";
  if (run === "check") return "/onboarding check";
  return `/onboarding ${run}`;
}

/* ------------------------------------------------------------------ *
 * .env.local merge — the host owns secret values, the agent never sees them.
 * ------------------------------------------------------------------ */

function readEnvLines() {
  if (!existsSync(ENV_FILE)) return [];
  return readFileSync(ENV_FILE, "utf8").split(/\r?\n/);
}

function envValueOf(name) {
  for (const line of readEnvLines()) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(line);
    if (m && m[1] === name) return m[2];
  }
  return undefined;
}

function envHasValue(name) {
  const v = envValueOf(name);
  return v !== undefined && v.trim() !== "";
}

/**
 * Merge one variable into .env.local, preserving every existing line.
 * Returns "created" | "appended" | "replaced" | "exists".
 */
function mergeEnv(name, value, { overwrite = false } = {}) {
  const existing = envValueOf(name);
  if (existing !== undefined && existing.trim() !== "" && !overwrite) return "exists";
  const serialized = `${name}=${value}`;
  if (!existsSync(ENV_FILE)) {
    writeFileSync(ENV_FILE, `${serialized}\n`, { encoding: "utf8", mode: 0o600 });
    return "created";
  }
  const lines = readEnvLines();
  const idx = lines.findIndex((l) => {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(l);
    return m && m[1] === name;
  });
  if (idx >= 0) {
    lines[idx] = serialized;
    writeFileSync(ENV_FILE, lines.join("\n"), "utf8");
    return "replaced";
  }
  const needsNewline = lines.length > 0 && lines[lines.length - 1] !== "";
  appendFileSync(ENV_FILE, `${needsNewline ? "\n" : ""}${serialized}\n`, "utf8");
  return "appended";
}

/* ------------------------------------------------------------------ *
 * Session
 * ------------------------------------------------------------------ */

class Session {
  constructor(broadcast) {
    this.broadcast = broadcast;
    this.child = null;
    this.buffer = "";
    /** request_id -> { toolName, input, tool_use_id, … } awaiting a UI decision. */
    this.pendingAsks = new Map();
    /** card id -> { requestId, question, secret, envName } for AskUserQuestion items. */
    this.pendingItems = new Map();
    /** shapeKey -> true, for the life of this run. */
    this.alwaysAllow = new Set();
    this.running = false;
    this.seq = 0;
    /** Bumped on every start/stop; stale child handlers check it and no-op. */
    this.runId = 0;
    this.phase = null;
    this.lastStatus = "";
    this.appPort = APP_PORT_OVERRIDE;
    this.stderrTail = "";
    /** The agent-declared step rail, or null before the first plan marker. */
    this.plan = null;
  }

  emit(type, payload) {
    this.broadcast({ type, seq: ++this.seq, at: Date.now(), ...payload });
  }

  /** One-line "what is happening now", deduped against the previous one. */
  status(text) {
    const t = String(text || "").trim();
    if (!t || t === this.lastStatus) return;
    this.lastStatus = t;
    this.emit("status", { text: t });
  }

  /**
   * Phase ids are free-form since v0.3 — the recon-first run declares its own
   * with a plan marker — so the only gate is the slug shape. `check` and
   * single-group runs keep emitting the legacy fixed ids, which still pass.
   */
  setPhase(id) {
    if (!PHASE_ID_RE.test(id) || this.phase === id) return;
    this.phase = id;
    this.emit("phase", { id });
  }

  /** A declared step rail. Re-emitted whenever the journey changes mid-run. */
  setPlan(steps) {
    if (!steps.length) return;
    this.plan = steps;
    this.emit("plan", { steps });
  }

  setAppPort(port) {
    const n = Number(port);
    if (!Number.isInteger(n) || n <= 0 || n > 65535) return;
    this.appPort = n;
    this.emit("app", { port: n });
  }

  async start(run) {
    if (this.running) return { ok: false, error: "A session is already running. Stop it first." };
    // Computed BEFORE the child exists so the very first message the agent sees
    // already says where this install is — the recon-first flow depends on it.
    let inventory;
    try {
      inventory = await hostInventory();
    } catch (err) {
      inventory = `HOST INVENTORY unavailable (${err.message}) — probe the install yourself, but still never read the env file.\n\n`;
    }
    if (this.running) return { ok: false, error: "A session is already running. Stop it first." };
    const cliPath = process.env.KP_CLAUDE_CLI || "claude";
    const args = [
      "--output-format", "stream-json",
      "--verbose",
      "--input-format", "stream-json",
      "--permission-prompt-tool", "stdio",
    ];
    const env = { ...process.env, CLAUDE_CODE_ENTRYPOINT: "sdk-ts" };
    // Subscription login only: an inherited key would silently bill an account.
    for (const key of Object.keys(env)) {
      if (/^ANTHROPIC_.*(API_KEY|AUTH_TOKEN)$/.test(key)) delete env[key];
    }
    delete env.ANTHROPIC_API_KEY;
    delete env.NODE_OPTIONS;

    // Fresh state BEFORE the child exists, so a restart never inherits the last
    // run's pending cards, allow-list or phase.
    const runId = ++this.runId;
    this.buffer = "";
    this.pendingAsks.clear();
    this.pendingItems.clear();
    this.alwaysAllow.clear();
    this.phase = null;
    this.lastStatus = "";
    this.stderrTail = "";
    this.appPort = APP_PORT_OVERRIDE;
    this.plan = null;

    let child;
    try {
      child = spawn(cliPath, args, {
        cwd: REPO_ROOT, env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
        shell: process.platform === "win32" && !path.isAbsolute(cliPath),
      });
    } catch (err) {
      return { ok: false, error: `Could not start the Claude CLI (${cliPath}): ${err.message}` };
    }
    this.child = child;
    this.running = true;

    child.stdout.on("data", (d) => { if (this.runId === runId) this.onStdout(d); });
    child.stderr.on("data", (d) => {
      if (this.runId !== runId) return;
      // Never broadcast: a stray stderr line could carry anything. Kept only to
      // explain a non-zero exit, and capped.
      this.stderrTail = (this.stderrTail + String(d)).slice(-2000);
    });
    child.on("error", (err) => {
      if (this.runId !== runId) return;
      this.running = false;
      this.emit("error", { message: `Claude CLI failed to start: ${err.message}` });
      this.emit("done", { exitCode: null });
    });
    child.on("exit", (code) => {
      if (this.runId !== runId) return;
      this.running = false;
      this.child = null;
      this.failPending("The setup assistant exited.");
      if (code) {
        this.emit("error", { message: this.stderrTail.trim() || `The setup assistant exited with code ${code}.` });
      }
      this.emit("done", { exitCode: code });
    });

    this.setPhase(isStartRun(run) ? "assess" : "welcome");
    this.status(`Starting the setup assistant (${invocationFor(run)})…`);
    this.write({ request_id: randomBytes(8).toString("hex"), type: "control_request", request: { subtype: "initialize" } });
    this.sendUser(`${preamble(run)}${inventory}${invocationFor(run)}`);
    return { ok: true };
  }

  write(obj) {
    if (!this.child || this.child.stdin.writableEnded) return;
    try {
      this.child.stdin.write(JSON.stringify(obj) + "\n");
    } catch {
      // A closed pipe means the session is gone; the exit handler reports it.
    }
  }

  sendUser(text) {
    this.write({
      type: "user",
      session_id: "",
      message: { role: "user", content: [{ type: "text", text }] },
      parent_tool_use_id: null,
    });
  }

  respond(requestId, response) {
    this.write({ type: "control_response", response: { subtype: "success", request_id: requestId, response } });
  }

  onStdout(chunk) {
    this.buffer += String(chunk);
    let nl;
    while ((nl = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, nl).trim();
      this.buffer = this.buffer.slice(nl + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      try {
        this.onMessage(msg);
      } catch (err) {
        this.emit("error", { message: `handler error: ${err.message}` });
      }
    }
  }

  onMessage(msg) {
    if (msg.type === "control_request") return this.onControlRequest(msg);
    if (msg.type === "control_response") return; // only the initialize ack; nothing to do
    if (msg.type === "system" && msg.subtype === "init") {
      this.status("Connected to the setup assistant.");
      return;
    }
    if (msg.type === "assistant") {
      // Matrix state spans the content blocks of ONE message: everything after
      // the marker, to end of message, is the capability matrix.
      const state = { matrix: null };
      for (const c of msg.message?.content ?? []) {
        if (c.type === "text" && c.text) this.consumeText(c.text, state);
        if (c.type === "tool_use") this.noteToolActivity(c.name, c.input);
      }
      if (state.matrix) {
        const md = state.matrix.join("\n").trim();
        if (md) this.emit("matrix", { md });
      }
      return;
    }
    // tool_result and result frames carry no operator-facing prose that the
    // narration has not already said, so they are deliberately not broadcast.
  }

  /** Strip host markers out of one text block, emit them, narrate the rest. */
  consumeText(text, state) {
    const prose = [];
    const flush = () => {
      const md = prose.join("\n").trim();
      prose.length = 0;
      if (md) this.emit("narration", { md });
    };
    for (const line of String(text).split(/\r?\n/)) {
      if (state.matrix) { state.matrix.push(line); continue; }
      const m = MARKER_RE.exec(line);
      if (!m) { prose.push(line); continue; }
      flush();
      this.onMarker(m[1], parseMarkerAttrs(m[2] || ""), state);
    }
    flush();
  }

  onMarker(kind, attrs, state) {
    if (kind === "phase") return this.setPhase(String(attrs.id || ""));
    if (kind === "plan") return this.setPlan(parsePlanSteps(attrs.steps));
    if (kind === "status") return this.status(attrs.text ?? "");
    if (kind === "probe") {
      const name = String(attrs.name || "").trim();
      if (!name) return;
      const st = PROBE_STATES.has(attrs.status) ? attrs.status : "warn";
      return this.emit("probe", { name, status: st, detail: String(attrs.detail ?? "") });
    }
    if (kind === "app") return this.setAppPort(attrs.port);
    if (kind === "matrix") {
      state.matrix = [];
      this.setPhase("done");
    }
  }

  /** Cheap status even when the agent forgets its markers. */
  noteToolActivity(name, input) {
    if (name === "Bash" || name === "PowerShell") {
      const cmd = String(input?.command ?? "").replace(/\s+/g, " ").trim();
      if (cmd) this.status(`Running: ${cmd.length > 60 ? `${cmd.slice(0, 60)}…` : cmd}`);
      return;
    }
    if (INSPECT_TOOLS.has(name)) this.status("Inspecting the project…");
  }

  onControlRequest(msg) {
    const req = msg.request ?? {};
    if (req.subtype !== "can_use_tool") {
      this.write({
        type: "control_response",
        response: { subtype: "error", request_id: msg.request_id, error: `unsupported subtype: ${req.subtype}` },
      });
      return;
    }
    const { tool_name: toolName, input, tool_use_id: toolUseID } = req;

    // AskUserQuestion is always intercepted and always allowed — with an answer.
    if (toolName === "AskUserQuestion") {
      this.openQuestions(msg.request_id, input, toolUseID);
      return;
    }

    // Host policy, not an operator decision: the env file's VALUES never enter
    // model context. Denied silently — no card, no status line — because there
    // is nothing here for the operator to weigh up.
    if (targetsEnvFile(toolName, input)) {
      this.respond(msg.request_id, { behavior: "deny", message: ENV_GUARD_MESSAGE, toolUseID });
      return;
    }

    this.noteToolActivity(toolName, input);

    if (AUTO_ALLOW.has(toolName)) {
      this.respond(msg.request_id, { behavior: "allow", updatedInput: input, toolUseID });
      return;
    }

    const key = shapeKey(toolName, input);
    if (this.alwaysAllow.has(key)) {
      this.respond(msg.request_id, { behavior: "allow", updatedInput: input, toolUseID });
      return;
    }

    this.pendingAsks.set(msg.request_id, { kind: "permission", toolName, input, toolUseID, key });
    const { verb, detail, note } = describeAsk(toolName, input);
    this.emit("permission", {
      id: msg.request_id,
      tool: toolName,
      command: detail,
      description: note || `The assistant wants to ${verb}.`,
      shape: key,
    });
  }

  /** Fan one AskUserQuestion out into one card per question. */
  openQuestions(requestId, input, toolUseID) {
    const questions = Array.isArray(input?.questions) ? input.questions : [];
    const ask = { kind: "question", input, toolUseID, answers: {}, open: new Set() };
    this.pendingAsks.set(requestId, ask);

    if (questions.length === 0) {
      // Nothing to ask — allow it through rather than stranding the agent.
      this.pendingAsks.delete(requestId);
      this.respond(requestId, { behavior: "allow", updatedInput: { ...input, answers: {} }, toolUseID });
      return;
    }

    questions.forEach((q, i) => {
      const id = `${requestId}#${i}`;
      const secret = isSecretQuestion(q);
      const envName = secret ? envNameFrom(q) : null;
      const text = String(q?.question ?? "");
      ask.open.add(id);
      const alreadySet = secret && !!envName && envHasValue(envName);
      this.pendingItems.set(id, { requestId, question: text, secret: secret && !!envName, envName, alreadySet });
      if (secret && envName) {
        this.emit("secret", { id, name: envName, note: text, alreadySet });
      } else {
        this.emit("question", {
          id,
          header: String(q?.header ?? ""),
          question: text,
          multiSelect: !!q?.multiSelect,
          options: (q?.options ?? []).map((o) => ({ label: o.label, description: o.description })),
        });
      }
    });
  }

  /** Record one card's answer; respond to the CLI once every card is in. */
  answerItem(id, answerText) {
    const item = this.pendingItems.get(id);
    if (!item) return { ok: false, error: "No pending question with that id." };
    const ask = this.pendingAsks.get(item.requestId);
    if (!ask) {
      this.pendingItems.delete(id);
      return { ok: false, error: "That question is no longer open." };
    }
    this.pendingItems.delete(id);
    ask.open.delete(id);
    ask.answers[item.question] = String(answerText ?? "");
    if (ask.open.size === 0) {
      this.pendingAsks.delete(item.requestId);
      this.respond(item.requestId, {
        behavior: "allow",
        updatedInput: { ...ask.input, answers: ask.answers },
        toolUseID: ask.toolUseID,
      });
    }
    return { ok: true, pending: ask.open.size };
  }

  itemFor(id) {
    return this.pendingItems.get(id) ?? null;
  }

  decide(id, allow, { always = false, reason = "" } = {}) {
    const pending = this.pendingAsks.get(id);
    if (!pending || pending.kind !== "permission") return { ok: false, error: "No pending permission with that id." };
    this.pendingAsks.delete(id);
    if (allow) {
      if (always && pending.key) this.alwaysAllow.add(pending.key);
      this.respond(id, { behavior: "allow", updatedInput: pending.input, toolUseID: pending.toolUseID });
    } else {
      this.respond(id, {
        behavior: "deny",
        message: reason || "The operator declined this step in the installer wizard. Do not retry it; continue with the rest of the run and record it as skipped.",
        toolUseID: pending.toolUseID,
      });
    }
    return { ok: true };
  }

  /** Drop every open card. Nothing may stay half-asked across a stop or exit. */
  failPending(why) {
    for (const [id, ask] of this.pendingAsks) {
      if (ask.kind === "permission") {
        // Best effort: if the pipe is already gone, write() is a no-op.
        this.respond(id, { behavior: "deny", message: why, toolUseID: ask.toolUseID });
      }
    }
    this.pendingAsks.clear();
    this.pendingItems.clear();
  }

  /**
   * Stop the run — for real. `child.kill()` on Windows kills only the launcher:
   * claude.exe spawns PowerShell/node/npm grandchildren that survive it and keep
   * the session alive, which is exactly the bug the Stop button had. `taskkill
   * /T /F` is the only thing that takes the tree down.
   */
  stop() {
    const child = this.child;
    // Synchronous first: a bumped runId makes every buffered stdout chunk,
    // stderr line and exit event from this child a no-op from here on.
    this.runId += 1;
    this.child = null;
    const wasRunning = this.running;
    this.running = false;
    this.failPending("The operator stopped the installer.");
    this.phase = null;
    this.lastStatus = "";
    this.buffer = "";
    this.plan = null;
    this.alwaysAllow.clear();

    if (child) {
      try { child.stdin.end(); } catch { /* already closed */ }
      if (process.platform === "win32" && child.pid) {
        // Ignore the result: a race with a self-exit is a success, not an error.
        try {
          spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
        } catch { /* taskkill missing — fall through to kill() */ }
        try { child.kill(); } catch { /* gone */ }
      } else {
        try { child.kill("SIGTERM"); } catch { /* gone */ }
        setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* gone */ } }, 1500).unref?.();
      }
    }

    this.emit("stopped", {});
    return { ok: true, wasRunning };
  }
}

function isSecretQuestion(q) {
  if (!q) return false;
  if (String(q.header ?? "").trim().toLowerCase() === "secret") return true;
  return /\b[A-Z][A-Z0-9]*(_[A-Z0-9]+)*\b/.test(String(q.question ?? "")) &&
    /\b(key|token|secret|password)\b/i.test(String(q.question ?? ""));
}

/** Pull the env variable name out of a secret question's text. */
function envNameFrom(q) {
  const m = /\b([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)\b/.exec(String(q?.question ?? ""));
  return m ? m[1] : null;
}

/* ------------------------------------------------------------------ *
 * App proxy — the page cannot reach the booted app cross-origin, so the
 * host relays. The port comes from the [[wizard:app]] marker.
 * ------------------------------------------------------------------ */

/** Server-chosen, capped sample text. The page never supplies synthesis text. */
function sampleSentence(language) {
  return String(language || "").toLowerCase().startsWith("cs")
    ? "Dobrý den, takto bude znít KP, když nahlas přečte zprávu pro kandidáta."
    : "Hello — this is how KP will sound when it reads a message out loud.";
}

const PROVIDER_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;

async function appFetch(pathname, init = {}, timeoutMs = 8000) {
  const port = session.appPort;
  if (!port) {
    const err = new Error("The app has not reported a port yet — finish boot verify first.");
    err.noPort = true;
    throw err;
  }
  return await fetch(`http://127.0.0.1:${port}${pathname}`, {
    ...init,
    signal: AbortSignal.timeout(timeoutMs),
  });
}

/* ------------------------------------------------------------------ *
 * HTTP
 * ------------------------------------------------------------------ */

const clients = new Set();
function broadcast(event) {
  const frame = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of clients) {
    try { res.write(frame); } catch { clients.delete(res); }
  }
}
const session = new Session(broadcast);

function tokenOf(req, url) {
  return url.searchParams.get("t") || req.headers["x-onboard-token"] || "";
}

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(payload) });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > 1e6) reject(new Error("body too large"));
    });
    req.on("end", () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch (err) { reject(err); }
    });
    req.on("error", reject);
  });
}

/** Static assets served beside the page: the sibling UI may split into files. */
const STATIC_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
};

function serveStatic(res, fullPath, ext) {
  const body = readFileSync(fullPath);
  res.writeHead(200, { "content-type": STATIC_TYPES[ext], "cache-control": "no-store", "content-length": body.length });
  res.end(body);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  const p = url.pathname;

  if (p === "/" || p === "/wizard.html") {
    serveStatic(res, path.join(HERE, "wizard.html"), ".html");
    return;
  }

  // Static assets are token-free, like the page itself. Extension allow-list +
  // a containment check, so nothing outside this directory can be read.
  if (req.method === "GET") {
    let rel = "";
    try { rel = decodeURIComponent(p).replace(/^\/+/, ""); } catch { rel = ""; }
    const ext = path.extname(rel).toLowerCase();
    if (rel && STATIC_TYPES[ext]) {
      const full = path.resolve(HERE, rel);
      if (full.startsWith(HERE + path.sep) && existsSync(full)) {
        serveStatic(res, full, ext);
        return;
      }
    }
  }

  if (tokenOf(req, url) !== TOKEN) {
    json(res, 403, { error: "Bad or missing token. Open the URL printed in the terminal." });
    return;
  }

  if (p === "/events") {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-store",
      connection: "keep-alive",
    });
    res.write(`data: ${JSON.stringify({
      type: "hello",
      repo: REPO_ROOT,
      envFileExists: existsSync(ENV_FILE),
      running: session.running,
      phase: session.phase,
      plan: session.plan,
      appPort: session.appPort,
    })}\n\n`);
    clients.add(res);
    const ping = setInterval(() => { try { res.write(": ping\n\n"); } catch { /* closed */ } }, 20000);
    req.on("close", () => { clearInterval(ping); clients.delete(res); });
    return;
  }

  // ---- app proxy: GET side (poll-friendly) ----
  if (req.method === "GET" && p === "/app/health") {
    try {
      const r = await appFetch("/api/health", {}, 4000);
      json(res, 200, { ok: r.ok, port: session.appPort, status: r.status });
    } catch (err) {
      json(res, 200, { ok: false, port: session.appPort, reason: err.message });
    }
    return;
  }

  if (req.method === "GET" && p === "/app/tts") {
    try {
      const r = await appFetch("/api/tts", { headers: { accept: "application/json" } }, 15000);
      const ct = r.headers.get("content-type") || "";
      const text = await r.text();
      if (ct.includes("application/json")) {
        res.writeHead(r.status, { "content-type": "application/json", "cache-control": "no-store" });
        res.end(text);
      } else {
        // 401 in team mode, or an HTML error page. Pass the status through
        // honestly rather than inventing a shape.
        json(res, r.status, { error: "The app did not answer with JSON.", status: r.status, contentType: ct });
      }
    } catch (err) {
      json(res, err.noPort ? 409 : 502, { error: err.message });
    }
    return;
  }

  if (req.method !== "POST") { json(res, 404, { error: "not found" }); return; }

  let body;
  try { body = await readBody(req); } catch (err) { json(res, 400, { error: err.message }); return; }

  switch (p) {
    case "/start":
      json(res, 200, await session.start(String(body.run || "start")));
      return;
    case "/answer": {
      const id = String(body.id ?? body.requestId ?? "");
      const raw = Array.isArray(body.answer) ? body.answer.join(", ") : body.answer;
      json(res, 200, session.answerItem(id, String(raw ?? "")));
      return;
    }
    case "/decision":
      json(res, 200, session.decide(String(body.id ?? body.requestId ?? ""), !!body.allow, {
        always: !!body.always,
        reason: typeof body.reason === "string" ? body.reason : "",
      }));
      return;
    case "/secret": {
      // The value stops HERE. It is never emitted, logged, or shown to the agent.
      const id = String(body.id ?? "");
      const item = session.itemFor(id);
      if (!item || !item.envName) { json(res, 404, { error: "No pending secret with that id." }); return; }
      const name = item.envName;
      const action = String(body.action || "save");

      if (action === "skip") {
        session.answerItem(id, `${name} skipped`);
        session.status(`${name} skipped.`);
        json(res, 200, { ok: true, state: "skipped" });
        return;
      }
      if (action === "keep") {
        session.answerItem(id, `${name} kept — an existing value in the env file was left untouched by the installer host (do not read or echo it)`);
        session.status(`${name} left as it was.`);
        json(res, 200, { ok: true, state: "kept" });
        return;
      }
      if (action !== "save") { json(res, 400, { error: `Unknown action: ${action}` }); return; }

      const value = String(body.value ?? "");
      if (!value) { json(res, 400, { error: "No value supplied." }); return; }
      // Overwrite only when the CARD told the operator a value was already
      // there and they chose to save anyway. Keying off the file's state right
      // now would silently clobber a value that appeared after the card was
      // drawn, which is the whole point of the no-clobber default.
      const state = mergeEnv(name, value, { overwrite: item.alreadySet === true });
      if (state === "exists") {
        // Defense in depth: re-surface the card with the truth instead of
        // clobbering. The item stays open, now knowing a value is there.
        item.alreadySet = true;
        session.emit("secret", { id, name, note: item.question, alreadySet: true });
        json(res, 200, { ok: true, state: "exists" });
        return;
      }
      session.answerItem(id, `${name} is set (written by the installer host — do not read or echo its value)`);
      session.status(`${name} written to the env file.`);
      json(res, 200, { ok: true, state });
      return;
    }
    case "/message":
      if (!session.running) { json(res, 409, { error: "No session is running." }); return; }
      session.sendUser(String(body.text || ""));
      json(res, 200, { ok: true });
      return;
    case "/stop":
      json(res, 200, session.stop());
      return;

    // ---- app proxy: POST side ----
    case "/app/tts/sample": {
      const provider = String(body.provider ?? "");
      if (provider && !PROVIDER_RE.test(provider)) { json(res, 400, { error: "Not a provider id." }); return; }
      const voiceId = typeof body.voiceId === "string" && body.voiceId.length <= 128 ? body.voiceId : null;
      const language = typeof body.language === "string" ? body.language.slice(0, 16) : null;
      const text = sampleSentence(language).slice(0, 120);
      try {
        const r = await appFetch("/api/tts", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text, language, ...(provider ? { provider } : {}), ...(voiceId ? { voiceId } : {}) }),
        }, 120000);
        const ct = r.headers.get("content-type") || "";
        if (!r.ok || !ct.startsWith("audio/")) {
          const errText = await r.text();
          if (ct.includes("application/json")) {
            res.writeHead(r.status, { "content-type": "application/json", "cache-control": "no-store" });
            res.end(errText);
          } else {
            json(res, r.status, { error: "The app did not return audio.", status: r.status, contentType: ct });
          }
          return;
        }
        const bytes = Buffer.from(await r.arrayBuffer());
        const headers = {
          "content-type": ct,
          "cache-control": "no-store",
          "content-length": bytes.length,
        };
        for (const h of ["x-tts-voice", "x-tts-provider", "x-tts-elapsed-ms", "x-tts-fallback-from"]) {
          const v = r.headers.get(h);
          if (v) headers[h] = v;
        }
        res.writeHead(200, headers);
        res.end(bytes);
      } catch (err) {
        json(res, err.noPort ? 409 : 502, { error: err.message });
      }
      return;
    }
    case "/choice/tts": {
      if (body.skipped) {
        session.status("Spoken-output check skipped.");
        session.sendUser("Host note: spoken-output check skipped by the operator. Record TTS as not configured in the final matrix and continue.");
        json(res, 200, { ok: true, state: "skipped" });
        return;
      }
      const provider = String(body.provider ?? "");
      if (!PROVIDER_RE.test(provider)) { json(res, 400, { error: "Not a provider id." }); return; }
      // Not a secret — a plain preference, so overwriting is the point.
      const state = mergeEnv("KP_TTS_PROVIDER", provider, { overwrite: true });
      session.status(`KP_TTS_PROVIDER set to ${provider}.`);
      session.sendUser(
        `Host note: spoken-output check — the operator chose ${provider} as the default text-to-speech provider, and KP_TTS_PROVIDER=${provider} was written into the env file by the host. Reflect that in the final capability matrix and continue.`,
      );
      json(res, 200, { ok: true, state, provider });
      return;
    }
    default:
      json(res, 404, { error: "not found" });
  }
});

function listen(port, attempt = 0) {
  server.once("error", (err) => {
    if (err.code === "EADDRINUSE" && attempt < 10) return listen(port + 1, attempt + 1);
    console.error(`[onboard-ui] cannot listen: ${err.message}`);
    process.exit(1);
  });
  server.listen(port, "127.0.0.1", () => {
    const uiUrl = `http://127.0.0.1:${port}/?t=${TOKEN}`;
    console.log("");
    console.log("  kp installer wizard");
    console.log(`  ${uiUrl}`);
    console.log("");
    console.log("  This page can run commands and write .env.local — the token in the URL is");
    console.log("  what keeps other local processes out. Do not share it. Ctrl+C to stop.");
    console.log("");
    if (process.env.KP_ONBOARD_NO_OPEN !== "1") {
      const opener = process.platform === "win32" ? ["cmd", ["/c", "start", "", uiUrl]]
        : process.platform === "darwin" ? ["open", [uiUrl]]
          : ["xdg-open", [uiUrl]];
      try { spawn(opener[0], opener[1], { detached: true, stdio: "ignore", windowsHide: true }).unref(); } catch { /* no browser */ }
    }
  });
}

process.on("SIGINT", () => { session.stop(); process.exit(0); });
listen(Number(process.env.KP_ONBOARD_PORT) || BASE_PORT);
