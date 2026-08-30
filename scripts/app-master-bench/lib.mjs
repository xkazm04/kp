// Shared plumbing for the App-master mass-test driver.
//
// Deliberately dependency-free (global fetch + node: builtins only) so a bench
// run needs nothing `npm run test:unit` does not already have. The polling and
// journal shape follow uat/driver/lib.mjs — same lessons, no browser:
//
//   * predicate-first waits, never a fixed sleep. A phase that "took too long"
//     must name what never happened, not surface three steps later.
//   * a generous timeout is not a bug. A keyless intake turn spawns Python; a
//     live Personas night is minutes. Shortening a timeout to make a run pass
//     is how a bench starts lying.
//   * everything observed goes into the journal BEFORE it is interpreted, so a
//     failed run is still readable evidence.

import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** ✓ / ✗ / – — the eval suite's one glyph set (pipeline/jobfit/eval/runner.py). */
export const GLYPH_PASS = "✓";
export const GLYPH_FAIL = "✗";
export const GLYPH_NA = "–";

/** Render a verdict cell: ✓ pass · ✗ fail · – not-applicable (null). */
export function glyph(ok) {
  if (ok === null || ok === undefined) return GLYPH_NA;
  return ok ? GLYPH_PASS : GLYPH_FAIL;
}

/** The lead banner every eval report opens with: `▌ part · part · part`. */
export function verdictBanner(parts) {
  return `▌ ${parts.filter(Boolean).join(" · ")}`;
}

/** `2026-08-24T09-31-02` — a filesystem-safe stamp, sortable, no colons. */
export function runStamp(now = new Date()) {
  return now.toISOString().replace(/\.\d+Z$/, "").replace(/:/g, "-");
}

/** A phase failure that names its phase — the driver's exit contract. */
export class PhaseError extends Error {
  constructor(phase, message, detail = {}) {
    super(message);
    this.name = "PhaseError";
    this.phase = phase;
    this.detail = detail;
  }
}

/**
 * One JSON round trip, never throwing on a non-2xx: the STATUS is data the
 * journal wants. A transport failure (server down, DNS, abort) comes back as
 * `{ ok:false, status:0, error }` for the same reason.
 */
export async function fetchJson(url, { method = "GET", body, headers = {}, timeoutMs = 120_000 } = {}) {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      signal: controller.signal,
      headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { ok: res.ok, status: res.status, json, text, ms: Date.now() - started, error: null };
  } catch (error) {
    return { ok: false, status: 0, json: null, text: "", ms: Date.now() - started, error: String(error?.message || error) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Poll `fn` until it returns something truthy. Throws with the label on
 * timeout so the failure names the condition that never held.
 */
export async function poll(fn, { maxMs = 300_000, everyMs = 2_000, label = "condition" } = {}) {
  const start = Date.now();
  let last = null;
  while (Date.now() - start < maxMs) {
    last = await fn().catch(() => null);
    if (last) return last;
    await sleep(everyMs);
  }
  const err = new Error(`poll("${label}") timed out after ${maxMs}ms`);
  err.lastValue = last;
  throw err;
}

/**
 * The run journal: an append-only `journal.jsonl` beside the run's
 * `result.json`. Every entry is written the moment it happens — a run killed
 * halfway still leaves the evidence up to that point.
 */
export class Journal {
  constructor(dir, { echo = true } = {}) {
    this.dir = dir;
    this.file = path.join(dir, "journal.jsonl");
    this.echo = echo;
    mkdirSync(dir, { recursive: true });
  }

  write(kind, data = {}) {
    const entry = { at: new Date().toISOString(), kind, ...data };
    appendFileSync(this.file, `${JSON.stringify(entry)}\n`, "utf8");
    if (this.echo) {
      // stderr, so a caller can pipe stdout as the result document.
      const detail = JSON.stringify(data).slice(0, 400);
      process.stderr.write(`  ${kind} ${detail === "{}" ? "" : detail}\n`);
    }
    return entry;
  }
}

/**
 * kp's API surface, cookie-seeded the way the e2e specs seed dev auth.
 *
 * 429-AWARE, and that is not a nicety. kp rate-limits its own expensive routes
 * per IP — 30/10min on `POST /api/intake/[id]/message`, 10/10min on
 * `POST /api/repo-scan` — and a mass-test sweep is exactly the caller those
 * limits describe: four scenarios × nine dialog turns is 36 messages, which
 * trips the intake limiter partway through scenario three. The right answer is
 * to WAIT (the windows are fixed 10-minute buckets), never to raise the limit
 * for the bench's convenience: the throttle is a product property this driver
 * has to live under like any other client. Every wait is surfaced through
 * `onThrottle` so a slow sweep is visibly throttled rather than mysteriously slow.
 */
export function kpClient(baseUrl, { timeoutMs = 300_000, throttleWaitMs = 65_000, throttleAttempts = 12, onThrottle = null } = {}) {
  const base = baseUrl.replace(/\/$/, "");
  // `kp_entered` is the server-side landing gate. API routes do not read it
  // (they gate on requireOperator, a no-op in open dev mode), but sending it
  // costs nothing and keeps a password-less-but-entered deploy behaving the
  // same as the browser does.
  const headers = { cookie: "kp_entered=1" };
  const call = (method) => async (route, body, opts = {}) => {
    let waited = 0;
    for (let attempt = 0; ; attempt++) {
      const res = await fetchJson(base + route, { method, body, headers, timeoutMs, ...opts });
      if (res.status !== 429 || attempt >= throttleAttempts) {
        return waited > 0 ? { ...res, throttledMs: waited } : res;
      }
      onThrottle?.({ route, method, attempt: attempt + 1, waitMs: throttleWaitMs, waitedMs: waited });
      await sleep(throttleWaitMs);
      waited += throttleWaitMs;
    }
  };
  return {
    base,
    get: call("GET"),
    post: call("POST"),
    patch: call("PATCH"),
    del: call("DELETE"),
  };
}

// The driver's own client identity. Personas reads the pairing origin from the
// Origin HEADER (never the body) and binds the minted key + CORS entry to it —
// a Node fetch sends none on its own, so every /pair/* call carries this one.
// Constant on purpose: the cached key stays claimable across sweeps.
export const DRIVER_ORIGIN = "http://kp-app-master-bench.localhost";

/**
 * The Personas management API, bearer-gated once a pk_ key is in hand.
 *
 * 401-AWARE, for the same reason `kpClient` is 429-aware: the failure is a
 * PROPERTY of the thing being driven, not an accident. Personas' headless
 * auto-pair mints keys that live **24 hours**, and sweep #15 (2026-08-25)
 * crossed that boundary mid-run — the driver's cached key answered
 * `401 invalid api key` on `POST /api/kp/test/seed-work` and the scenario failed
 * a phase for a credential that expired between two sweeps. `onUnauthorized` is
 * given one chance to mint a new key; the call is then retried exactly ONCE.
 * A second 401 is returned as data, because at that point the key is not the
 * problem.
 */
export function personasClient(baseUrl, apiKey = null, { timeoutMs = 600_000, onUnauthorized = null } = {}) {
  const base = baseUrl.replace(/\/$/, "");
  const auth = () => ({ origin: DRIVER_ORIGIN, ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) });
  // Re-entrancy guard: the repair itself calls /pair/request + /pair/claim
  // through this client, and those are unauthenticated — a 401 from one of them
  // must not start a second repair on top of the first.
  let repairing = false;
  const send = (route, init) => fetchJson(base + route, { ...init, headers: auth(), timeoutMs });
  const withRepair = async (route, init) => {
    const res = await send(route, init);
    if (res.status !== 401 || !onUnauthorized || repairing) return res;
    repairing = true;
    let repaired = false;
    try {
      repaired = await onUnauthorized({ route, status: res.status, body: res.json });
    } finally {
      repairing = false;
    }
    if (!repaired) return res;
    const retry = await send(route, init);
    return { ...retry, repaired: true };
  };
  return {
    base,
    get key() {
      return apiKey;
    },
    setKey(k) {
      apiKey = k;
    },
    get: (route, opts = {}) => withRepair(route, { ...opts }),
    post: (route, body, opts = {}) => withRepair(route, { method: "POST", body, ...opts }),
  };
}

/**
 * Minimal `--flag value` / `--flag=value` / `--flag` parser. No deps.
 *
 * `booleans` names the flags that take NO value. Without it a bare `--all`
 * swallows the next bare word (`--all kp-c1-night` → `all: "kp-c1-night"`),
 * which reads as truthy AND eats the positional — the caller then cannot tell
 * that a scenario was named at all. Callers that know their flag arity should
 * pass it; omitting it keeps the original greedy behaviour exactly.
 */
export function parseArgs(argv, { booleans = null } = {}) {
  const takesNoValue = (key) => Array.isArray(booleans) && booleans.includes(key);
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      out._.push(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    if (eq > 0) {
      out[arg.slice(2, eq)] = arg.slice(eq + 1);
      continue;
    }
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!takesNoValue(key) && next !== undefined && !next.startsWith("--")) {
      out[key] = next;
      i++;
    } else {
      out[key] = true;
    }
  }
  return out;
}

/** ms → `1m 04s` / `812ms`, for a report cell a human reads at a glance. */
export function humanMs(ms) {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return GLYPH_NA;
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${String(Math.round(s - m * 60)).padStart(2, "0")}s`;
}
