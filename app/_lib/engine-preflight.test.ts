// The preflight that tells an operator whether the `claude` CLI is on PATH had no test
// at all, and its cache was for the PROCESS LIFETIME. That combination is worse than it
// sounds: the single most likely thing to happen right after an operator reads
// "claudeCli: false" on /api/ops is that they install the CLI — and until this change
// the page went on saying "absent" until someone restarted the server, so the fix looked
// like it had not worked. A TTL bounds that to ENGINE_PREFLIGHT_TTL_MS.
//
// Hermetic: PATH is pointed at a temp directory and the clock is injected, so nothing
// here depends on whether this machine actually has the CLI.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, unlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const { engineAvailability, ENGINE_PREFLIGHT_TTL_MS } = await import("./engine-preflight.ts");

/** The filename the probe looks for on this platform (PATHEXT-aware on Windows). */
const cliName = process.platform === "win32" ? "claude.CMD" : "claude";

function withPath<T>(dir: string, fn: () => T): T {
  const prev = process.env.PATH;
  process.env.PATH = dir;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.PATH;
    else process.env.PATH = prev;
  }
}

test("the Claude CLI probe re-scans PATH once its TTL expires", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "kp-preflight-"));
  const cli = path.join(dir, cliName);
  try {
    const t0 = 1_000_000;
    assert.equal(withPath(dir, () => engineAvailability(t0).claudeCli), false, "no CLI on the empty PATH dir");

    // The operator installs it. Inside the TTL the answer is still the cached one —
    // that is the cache doing its job, not a bug.
    writeFileSync(cli, "");
    assert.equal(
      withPath(dir, () => engineAvailability(t0 + ENGINE_PREFLIGHT_TTL_MS - 1).claudeCli),
      false,
      "inside the TTL the probe does not re-scan every PATH entry",
    );

    // Past it, the install is visible WITHOUT a server restart — the whole point.
    assert.equal(
      withPath(dir, () => engineAvailability(t0 + ENGINE_PREFLIGHT_TTL_MS).claudeCli),
      true,
      "past the TTL an installed CLI is reported present",
    );

    // …and the reverse: an uninstall is noticed too, so the probe is a live reading
    // rather than a one-way latch.
    unlinkSync(cli);
    assert.equal(
      withPath(dir, () => engineAvailability(t0 + 2 * ENGINE_PREFLIGHT_TTL_MS).claudeCli),
      false,
      "past the TTL a removed CLI is reported absent",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a Gemini key is read from either accepted env var, and neither means absent", () => {
  const keys = ["GEMINI_API_KEY", "GOOGLE_API_KEY"] as const;
  const prev = keys.map((k) => [k, process.env[k]] as const);
  try {
    for (const k of keys) delete process.env[k];
    assert.equal(engineAvailability().gemini, false);
    process.env.GOOGLE_API_KEY = "x";
    assert.equal(engineAvailability().gemini, true, "GOOGLE_API_KEY alone is enough");
    delete process.env.GOOGLE_API_KEY;
    process.env.GEMINI_API_KEY = "x";
    assert.equal(engineAvailability().gemini, true, "GEMINI_API_KEY alone is enough");
    // An empty value is not a key: it is the shape a half-filled .env leaves behind, and
    // reporting it as configured would send the operator hunting for a different fault.
    process.env.GEMINI_API_KEY = "";
    assert.equal(engineAvailability().gemini, false);
  } finally {
    for (const [k, v] of prev) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});
