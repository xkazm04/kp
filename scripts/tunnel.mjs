// tunnel — the pure + process halves of `npm run up -- --public` (cx T9).
//
// `--public` puts the candidate doors on the internet through a Cloudflare quick tunnel
// (no account, no config) while the studio stays behind the operator password. This
// file holds what that needs apart from the launcher itself so the parts that can be
// wrong are testable without a network: the trycloudflare URL parser, the password
// rules, the open-mode decision, and the cloudflared child.
//
// cloudflared is a THIRD-PARTY binary the owner installs; nothing here downloads it and
// no npm dependency is added. Node builtins only (up.mjs must run on any Node).
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";

export const MIN_PUBLIC_PASSWORD_LENGTH = 12;

/** The https quick-tunnel address in one line of cloudflared's output
 *  ("|  https://random-words-here.trycloudflare.com  |"), or null. */
export function parseTunnelUrl(text) {
  const m = /https:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)*\.trycloudflare\.com/i.exec(String(text || ""));
  return m ? m[0].toLowerCase() : null;
}

/** One line per platform; printed when cloudflared is not on PATH. */
export const CLOUDFLARED_INSTALL = [
  "Windows:  winget install --id Cloudflare.cloudflared",
  "macOS:    brew install cloudflared",
  "Linux:    https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/ (or your package manager)",
];

/** What `--public` does about the operator password. Pure: env + whether a person can
 *  be asked in, answer = what to do.
 *    have    a password is already configured (open mode is off) — nothing to ask
 *    prompt  open mode and a terminal is attached — ask for one
 *    refuse  open mode and nobody to ask — exit non-zero with `message` */
export function publicPasswordPlan(env, { isTTY }) {
  if (env.KP_OPERATOR_PASSWORD) return { action: "have" };
  if (isTTY) return { action: "prompt" };
  return {
    action: "refuse",
    message:
      "--public will not start in open mode (no KP_OPERATOR_PASSWORD): set KP_OPERATOR_PASSWORD in .env.local or the shell and run it again, or run it in a terminal to be asked.",
  };
}

/** Why a typed password is not acceptable, or null. */
export function passwordProblem(password, confirm) {
  if (String(password || "").length < MIN_PUBLIC_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PUBLIC_PASSWORD_LENGTH} characters - this studio is reachable from the internet.`;
  }
  if (password !== confirm) return "The two entries differ.";
  return null;
}

/** KP_OPERATOR_PASSWORD from .env.local / .env text (Next loads these for the app, but
 *  the launcher's own environment does not see them). Last assignment wins; quotes are
 *  stripped. Returns "" when absent or blank. */
export function passwordFromEnvFile(text) {
  let value = "";
  for (const raw of String(text || "").split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?KP_OPERATOR_PASSWORD\s*=\s*(.*?)\s*$/.exec(raw);
    if (!m) continue;
    value = m[1].replace(/^(["'])(.*)\1$/, "$2");
  }
  return value;
}

/** Ask for a line without echoing it. Resolves to the typed text; rejects on Ctrl+C. */
export function readHidden(question, { input = process.stdin, output = process.stderr } = {}) {
  return new Promise((resolve, reject) => {
    output.write(question);
    let buf = "";
    input.setRawMode?.(true);
    input.resume();
    input.setEncoding("utf8");
    const done = (fn, value) => {
      input.removeListener("data", onData);
      input.setRawMode?.(false);
      input.pause();
      output.write("\n");
      fn(value);
    };
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") return done(resolve, buf);
        if (ch === "\u0003") return done(reject, new Error("cancelled"));
        if (ch === "\u007f" || ch === "\u0008") buf = buf.slice(0, -1);
        else buf += ch;
      }
    };
    input.on("data", onData);
  });
}

/** Ask twice, hidden, until the password passes. Never echoes or logs it. */
export async function askNewPassword(io) {
  for (;;) {
    const first = await readHidden("Choose a studio password: ", io);
    const second = await readHidden("Repeat it: ", io);
    const problem = passwordProblem(first, second);
    if (!problem) return first;
    (io?.output || process.stderr).write(`${problem}\n`);
  }
}

/** True when `cloudflared` runs on this machine. */
export function cloudflaredAvailable() {
  const r = spawnSync("cloudflared", ["--version"], { stdio: "ignore", shell: process.platform === "win32" });
  return !r.error && r.status === 0;
}

/** A free local TCP port at or above `from` (the tunnel must be pointed at a port
 *  before the app has started, so the launcher chooses it). */
export function freePort(from = 3000) {
  return new Promise((resolve) => {
    const tryPort = (p) => {
      const srv = createServer();
      srv.once("error", () => tryPort(p + 1));
      srv.once("listening", () => srv.close(() => resolve(p)));
      srv.listen(p);
    };
    tryPort(from);
  });
}

/** Start `cloudflared tunnel --url http://localhost:<port>`. Resolves { url, child }
 *  once the trycloudflare address appears in its output (it logs to stderr); rejects
 *  on spawn failure, early exit, or `timeoutMs`. The caller owns killing the child. */
export function startQuickTunnel(port, { timeoutMs = 45_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("cloudflared", ["tunnel", "--no-autoupdate", "--url", `http://localhost:${port}`], {
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
    });
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(reject, new Error(`cloudflared did not report a public address within ${timeoutMs / 1000}s`));
    }, timeoutMs);
    const onData = (chunk) => {
      const url = parseTunnelUrl(chunk.toString("utf8"));
      if (url) finish(resolve, { url, child });
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("error", (err) => finish(reject, err));
    child.on("exit", (code) => finish(reject, new Error(`cloudflared exited early (code ${code})`)));
  });
}

/** Stop a tunnel child (whole tree on Windows, where shell:true wraps it). */
export function killTunnel(child) {
  if (!child || child.pid == null || child.killed) return;
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" });
  else {
    try { child.kill("SIGTERM"); } catch { /* already gone */ }
  }
}
