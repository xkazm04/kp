#!/usr/bin/env node
/**
 * kp installer wizard — the HTTP SHELL.
 *
 * The engine (CLI session, permission policy, env-file writes, markers, the app
 * proxy) is `engine.mjs`. This file is everything that speaks HTTP: routes, the
 * SSE fan-out, the per-run token, CORS for the in-app studio, the static page
 * and the startup banner. Split in v0.6 — see the engine's header and
 * docs/concepts/onboarding-in-app.md for why.
 *
 * Zero npm dependencies by design — this is the FIRST thing a fresh clone runs,
 * possibly before `npm install`.
 *
 * Security posture: binds 127.0.0.1 only and every mutating request must carry
 * the per-run token printed at startup. This process approves shell commands and
 * writes .env.local, so an unauthenticated local port would be a real hole.
 * Static files (the page and its assets) are served token-free — they are the
 * door, not the keys.
 *
 * CORS does not change any of that. It is TRANSPORT — which origins a browser
 * may let read a response — and the token is AUTH. Every mutating route and
 * `/events` require the token whatever the Origin says, and a browser that
 * cannot produce the token gets a 403 from an origin the CORS layer was happy
 * with. The two are checked independently and neither substitutes for the other.
 */
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

import {
  HERE,
  REPO_ROOT,
  PERMISSION_MODE,
  PROVIDER_RE,
  Session,
  assertEnforcement,
  buildArgs,
  envFileExists,
  mergeEnv,
  sampleSentence,
} from "./engine.mjs";

/* The engine's test surface is re-exported so a driver can import EITHER file:
   the split is an implementation detail of this process, not of its contract. */
export {
  assertEnforcement,
  buildArgs,
  classifyCommand,
  classifyPythonImportProbe,
  isProtectedEnvName,
  overlayProbeCommands,
  parseProbeTable,
  sanitizeEnv,
} from "./engine.mjs";

const BASE_PORT = 4655;
const TOKEN = randomBytes(24).toString("hex");

/**
 * The in-app studio (`<app>/setup/studio`) is the second face on this engine.
 * `KP_ONBOARD_STUDIO=0` withdraws the offer: the flag is omitted from `hello`
 * and the standalone page never draws the hand-off, which is the only place it
 * is advertised. The standalone page remains fully functional either way — it
 * is the bootstrap face, and a machine whose app cannot boot never sees a
 * studio at all.
 */
const STUDIO_OFFER = process.env.KP_ONBOARD_STUDIO !== "0";

/* ------------------------------------------------------------------ *
 * CORS — loopback origins only, reflected, never `*`.
 *
 * The studio page is served by the kp app, whose port is NOT fixed on a shared
 * box (dev-guard hands out whatever is free), so the allowlist cannot be a port
 * — it is the loopback host set, any port. `*` is refused on principle: this
 * server writes .env.local and approves shell commands, and an allowlist that
 * matches everything is not one.
 *
 * No credentials: nothing here uses cookies, so `Access-Control-Allow-
 * Credentials` is never sent and the token travels explicitly (`?t=` for
 * EventSource, which cannot set headers; `x-onboard-token` otherwise).
 * ------------------------------------------------------------------ */

/** `http://localhost:3000`, `http://127.0.0.1:4655`, `http://[::1]:8080`. */
const LOOPBACK_ORIGIN = /^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/;

/** Response headers a cross-origin JS caller is allowed to READ. */
const EXPOSED_HEADERS = "x-tts-voice, x-tts-provider, x-tts-elapsed-ms, x-tts-fallback-from";

export function isAllowedOrigin(origin) {
  return typeof origin === "string" && LOOPBACK_ORIGIN.test(origin);
}

/**
 * The CORS headers for one request, or `{}` when the Origin is not loopback —
 * a foreign origin gets NO grant, not a narrow one. `Vary: Origin` rides along
 * on every response (it is a cache-correctness header, not a grant) so a
 * response cached for one origin is never replayed to another.
 */
function corsHeaders(req) {
  const origin = req.headers.origin;
  if (!isAllowedOrigin(origin)) return { vary: "Origin" };
  return {
    "access-control-allow-origin": origin,
    "access-control-expose-headers": EXPOSED_HEADERS,
    vary: "Origin",
  };
}

/**
 * Answer a preflight. Deliberately BEFORE the token check: a browser never
 * attaches `x-onboard-token` (or any body) to an OPTIONS, so demanding one here
 * would fail every cross-origin POST with an error that looks like a CORS bug
 * and is really an auth one. The preflight grants nothing — the real request
 * still has to carry the token.
 */
function preflight(req, res) {
  const headers = corsHeaders(req);
  if (headers["access-control-allow-origin"]) {
    headers["access-control-allow-methods"] = "GET, POST, OPTIONS";
    headers["access-control-allow-headers"] = "content-type, x-onboard-token";
    headers["access-control-max-age"] = "600";
  }
  res.writeHead(204, headers);
  res.end();
}

/* ------------------------------------------------------------------ *
 * SSE fan-out
 *
 * A Set of open responses, not one: BOTH faces may watch the same run at the
 * same time (the standalone page and the studio, or two browsers). Every event
 * goes to every client, and the session state that decides what a card means is
 * the engine's, so the faces cannot disagree. A client that joins late is
 * caught up by the `replay` block of its own `hello` — see PROTOCOL.md.
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

/** The port this process actually bound (the listener retries on EADDRINUSE). */
function selfPort() {
  const address = server.address();
  return address && typeof address === "object" ? address.port : null;
}

function json(res, status, body, extra = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
    ...extra,
  });
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

function serveStatic(res, fullPath, ext, extra = {}) {
  const body = readFileSync(fullPath);
  res.writeHead(200, {
    "content-type": STATIC_TYPES[ext],
    "cache-control": "no-store",
    "content-length": body.length,
    ...extra,
  });
  res.end(body);
}

/**
 * What a face is handed the moment it connects. Two clients connecting at
 * different points in the same run get the SAME picture — the difference is
 * only how much of it arrives as replay rather than live.
 */
function helloPayload() {
  return {
    type: "hello",
    repo: REPO_ROOT,
    envFileExists: envFileExists(),
    running: session.running,
    phase: session.phase,
    plan: session.plan,
    appPort: session.appPort,
    // Where this wizard server is, so a face can build the hand-off URL (and
    // the studio can name the server it is talking to) without guessing.
    self: { port: selfPort() },
    // Present only when the offer is live. The page keys off the flag rather
    // than off its own env, because only the server reads KP_ONBOARD_STUDIO.
    ...(STUDIO_OFFER ? { studio: true } : {}),
    // What the page may honestly claim about this run. `skipFlagBlocked` is
    // asserted at launch AND re-asserted per spawn, not merely intended.
    enforcement: {
      mode: PERMISSION_MODE,
      skipFlagBlocked: true,
      askHook: true,
      autoAllowPolicy:
        "host-side read-only diagnostics plus skill/agent plumbing; every command and every plumbing call emits a notice",
    },
    replay: session.replayState(),
  };
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  const p = url.pathname;
  const cors = corsHeaders(req);

  // Preflight first, before anything that could 403 or 404 it.
  if (req.method === "OPTIONS") { preflight(req, res); return; }

  if (p === "/" || p === "/wizard.html") {
    serveStatic(res, path.join(HERE, "wizard.html"), ".html", cors);
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
        serveStatic(res, full, ext, cors);
        return;
      }
    }
  }

  // CORS is transport; this is auth. A loopback origin buys nothing here.
  if (tokenOf(req, url) !== TOKEN) {
    json(res, 403, { error: "Bad or missing token. Open the URL printed in the terminal." }, cors);
    return;
  }

  if (p === "/events") {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-store",
      connection: "keep-alive",
      ...cors,
    });
    // Written and registered in ONE synchronous step: no event can slip between
    // the replay this client is handed and the live stream it then joins.
    res.write(`data: ${JSON.stringify(helloPayload())}\n\n`);
    clients.add(res);
    const ping = setInterval(() => { try { res.write(": ping\n\n"); } catch { /* closed */ } }, 20000);
    req.on("close", () => { clearInterval(ping); clients.delete(res); });
    return;
  }

  // ---- app proxy: GET side (poll-friendly) ----
  if (req.method === "GET" && p === "/app/health") {
    try {
      const r = await session.appFetch("/api/health", {}, 4000);
      json(res, 200, { ok: r.ok, port: session.appPort, status: r.status }, cors);
    } catch (err) {
      json(res, 200, { ok: false, port: session.appPort, reason: err.message }, cors);
    }
    return;
  }

  if (req.method === "GET" && p === "/app/tts") {
    try {
      const r = await session.appFetch("/api/tts", { headers: { accept: "application/json" } }, 15000);
      const ct = r.headers.get("content-type") || "";
      const text = await r.text();
      if (ct.includes("application/json")) {
        res.writeHead(r.status, { "content-type": "application/json", "cache-control": "no-store", ...cors });
        res.end(text);
      } else {
        // 401 in team mode, or an HTML error page. Pass the status through
        // honestly rather than inventing a shape.
        json(res, r.status, { error: "The app did not answer with JSON.", status: r.status, contentType: ct }, cors);
      }
    } catch (err) {
      json(res, err.noPort ? 409 : 502, { error: err.message }, cors);
    }
    return;
  }

  if (req.method !== "POST") { json(res, 404, { error: "not found" }, cors); return; }

  let body;
  try { body = await readBody(req); } catch (err) { json(res, 400, { error: err.message }, cors); return; }

  switch (p) {
    case "/start":
      json(res, 200, await session.start(String(body.run || "start")), cors);
      return;
    case "/answer": {
      const id = String(body.id ?? body.requestId ?? "");
      const raw = Array.isArray(body.answer) ? body.answer.join(", ") : body.answer;
      json(res, 200, session.answerItem(id, String(raw ?? "")), cors);
      return;
    }
    case "/decision":
      // `body.always` is accepted for compatibility with older pages and does
      // nothing at all. Protection is not something the operator opts out of.
      json(res, 200, session.decide(String(body.id ?? body.requestId ?? ""), !!body.allow, {
        reason: typeof body.reason === "string" ? body.reason : "",
      }), cors);
      return;
    case "/secret": {
      // The value stops HERE. It is never emitted, logged, or shown to the agent.
      const id = String(body.id ?? "");
      const item = session.itemFor(id);
      if (!item || !item.envName) { json(res, 404, { error: "No pending secret with that id." }, cors); return; }
      const name = item.envName;
      const action = String(body.action || "save");

      if (action === "skip") {
        session.answerItem(id, `${name} skipped`, { outcome: "skipped" });
        session.status(`${name} skipped.`);
        json(res, 200, { ok: true, state: "skipped" }, cors);
        return;
      }
      if (action === "keep") {
        session.answerItem(
          id,
          `${name} kept — an existing value in the env file was left untouched by the installer host (do not read or echo it)`,
          { outcome: "kept" },
        );
        session.status(`${name} left as it was.`);
        json(res, 200, { ok: true, state: "kept" }, cors);
        return;
      }
      if (action !== "save") { json(res, 400, { error: `Unknown action: ${action}` }, cors); return; }

      const value = String(body.value ?? "");
      if (!value) { json(res, 400, { error: "No value supplied." }, cors); return; }
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
        json(res, 200, { ok: true, state: "exists" }, cors);
        return;
      }
      session.answerItem(
        id,
        `${name} is set (written by the installer host — do not read or echo its value)`,
        { outcome: "saved" },
      );
      session.status(`${name} written to the env file.`);
      json(res, 200, { ok: true, state }, cors);
      return;
    }
    case "/message":
      if (!session.running) { json(res, 409, { error: "No session is running." }, cors); return; }
      session.sendUser(String(body.text || ""));
      json(res, 200, { ok: true }, cors);
      return;
    case "/stop":
      json(res, 200, session.stop(), cors);
      return;

    // ---- app proxy: POST side ----
    case "/app/tts/sample": {
      const provider = String(body.provider ?? "");
      if (provider && !PROVIDER_RE.test(provider)) { json(res, 400, { error: "Not a provider id." }, cors); return; }
      const voiceId = typeof body.voiceId === "string" && body.voiceId.length <= 128 ? body.voiceId : null;
      const language = typeof body.language === "string" ? body.language.slice(0, 16) : null;
      const text = sampleSentence(language).slice(0, 120);
      try {
        const r = await session.appFetch("/api/tts", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text, language, ...(provider ? { provider } : {}), ...(voiceId ? { voiceId } : {}) }),
        }, 120000);
        const ct = r.headers.get("content-type") || "";
        if (!r.ok || !ct.startsWith("audio/")) {
          const errText = await r.text();
          if (ct.includes("application/json")) {
            res.writeHead(r.status, { "content-type": "application/json", "cache-control": "no-store", ...cors });
            res.end(errText);
          } else {
            json(res, r.status, { error: "The app did not return audio.", status: r.status, contentType: ct }, cors);
          }
          return;
        }
        const bytes = Buffer.from(await r.arrayBuffer());
        const headers = {
          "content-type": ct,
          "cache-control": "no-store",
          "content-length": bytes.length,
          ...cors,
        };
        for (const h of ["x-tts-voice", "x-tts-provider", "x-tts-elapsed-ms", "x-tts-fallback-from"]) {
          const v = r.headers.get(h);
          if (v) headers[h] = v;
        }
        res.writeHead(200, headers);
        res.end(bytes);
      } catch (err) {
        json(res, err.noPort ? 409 : 502, { error: err.message }, cors);
      }
      return;
    }
    case "/choice/tts": {
      if (body.skipped) {
        session.status("Spoken-output check skipped.");
        session.sendUser("Host note: spoken-output check skipped by the operator. Record TTS as not configured in the final matrix and continue.");
        json(res, 200, { ok: true, state: "skipped" }, cors);
        return;
      }
      const provider = String(body.provider ?? "");
      if (!PROVIDER_RE.test(provider)) { json(res, 400, { error: "Not a provider id." }, cors); return; }
      // Not a secret — a plain preference, so overwriting is the point.
      const state = mergeEnv("KP_TTS_PROVIDER", provider, { overwrite: true });
      session.status(`KP_TTS_PROVIDER set to ${provider}.`);
      session.sendUser(
        `Host note: spoken-output check — the operator chose ${provider} as the default text-to-speech provider, and KP_TTS_PROVIDER=${provider} was written into the env file by the host. Reflect that in the final capability matrix and continue.`,
      );
      json(res, 200, { ok: true, state, provider }, cors);
      return;
    }
    default:
      json(res, 404, { error: "not found" }, cors);
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

/* ------------------------------------------------------------------ *
 * Launch self-check.
 *
 * On the production argv this can never trip, which is exactly the point: it
 * is a standing assertion that the argv the engine builds still says what this
 * wizard claims it says. The value is in the failure mode — a future edit that
 * adds `--dangerously-skip-permissions`, drops the ask-hook or renames the mode
 * stops the wizard at startup instead of shipping a page that says "every
 * command asks first" over a session where they do not.
 *
 * KP_ONBOARD_NO_LISTEN=1 imports this module without binding a port, so a
 * driver can call assertEnforcement() on a deliberately poisoned argv.
 * ------------------------------------------------------------------ */

if (process.env.KP_ONBOARD_NO_LISTEN !== "1") {
  const launchProblems = assertEnforcement(buildArgs());
  if (launchProblems.length) {
    console.error("");
    console.error("  [onboard-ui] REFUSING TO START — permission enforcement is not intact.");
    console.error("  The wizard's whole promise is that every command is either policy-allowed");
    console.error("  by this host or shown to you. That is not true of the argv it just built:");
    console.error("");
    for (const problem of launchProblems) console.error(`    - ${problem}`);
    console.error("");
    process.exit(1);
  }

  process.on("SIGINT", () => { session.stop(); process.exit(0); });
  listen(Number(process.env.KP_ONBOARD_PORT) || BASE_PORT);
}

