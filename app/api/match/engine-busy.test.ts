// An engine overload is "busy — try again in a moment", on every door that spawns.
//
// python-runner refuses a spawn that waited out KP_PYTHON_QUEUE_WAIT_MS with a
// PipelineError 503 ENGINE_BUSY — a catalogued refusal the client resolves in the
// reader's language. Only /api/extract-text mapped it. /api/match answered it as a 500
// MATCH_RUN_FAILED, /api/match/reasoning as MATCH_REASONING_FAILED (the overload is not a
// ReasoningError, so it fell through), /api/profile/draft as PROFILE_DRAFT_FAILED: a
// retry-in-a-moment turned into an unexplained fault. Each route now reads the one
// predicate, engineRefusal(err), before its catch-all.
//
// Drives the REAL admission gate, not a stub of it: `node` stands in for PYTHON_CMD, a
// holder child takes the only slot (KP_PYTHON_MAX_CONCURRENT=1), and the route's own
// spawn waits out a 50 ms queue budget. The route's child therefore never forks.
// unit-db.ts must stay the FIRST project import.
// Run: node scripts/run-unit-tests.mjs "app/api/match/engine-busy.test.ts"
import { cleanupUnitDb } from "../../_lib/testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { register, registerHooks } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

register(new URL("../../_lib/testing/next-server-hooks.mjs", import.meta.url));

// `next/headers` cannot run outside a Next request scope; the routes only need "no
// cookie, no header" (open mode, default workspace, default locale).
const VIRTUAL_HEADERS = "kp-test:engine-busy-headers";
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/headers") return { url: VIRTUAL_HEADERS, shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === VIRTUAL_HEADERS) {
      return {
        format: "module",
        shortCircuit: true,
        source: `
          export async function cookies() { return { get: () => undefined }; }
          export async function headers() { return new Headers(); }
          export async function draftMode() { return { isEnabled: false }; }
        `,
      };
    }
    return nextLoad(url, context);
  },
});

process.env.PYTHON_CMD = process.execPath;
process.env.KP_LLM_USAGE_LOG = "0";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const { spawnPython, pythonSpawnLoad } = await import("../../_lib/python-runner.ts");
const matchRoute = await import("./route.ts");
const reasoningRoute = await import("./reasoning/route.ts");
const draftRoute = await import("../profile/draft/route.ts");

after(() => cleanupUnitDb());

type Post = (request: Request) => Promise<Response>;

/** Hold the engine's only slot, run `fn`, then release it. */
async function withEngineFull<T>(fn: () => Promise<T>): Promise<T> {
  const prev = { max: process.env.KP_PYTHON_MAX_CONCURRENT, wait: process.env.KP_PYTHON_QUEUE_WAIT_MS };
  process.env.KP_PYTHON_MAX_CONCURRENT = "1";
  process.env.KP_PYTHON_QUEUE_WAIT_MS = "50";
  const holder = new AbortController();
  const held = spawnPython(["-e", "setTimeout(()=>{},30000)"], { signal: holder.signal, timeoutMs: 60_000 }).result.catch(
    () => null,
  );
  try {
    assert.equal(pythonSpawnLoad().inFlight, 1, "the holder owns the only slot");
    return await fn();
  } finally {
    holder.abort();
    await held;
    for (const [key, value] of [
      ["KP_PYTHON_MAX_CONCURRENT", prev.max],
      ["KP_PYTHON_QUEUE_WAIT_MS", prev.wait],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

let ip = 0;
async function post(handler: Post, url: string, body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  // A fresh client address per call: the per-IP limiters are not what this file tests.
  const request = new Request(`http://localhost${url}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `10.9.0.${++ip}` },
    body: JSON.stringify(body),
  });
  const response = await handler(request as never);
  return { status: response.status, json: (await response.json()) as Record<string, unknown> };
}

const CANDIDATE = { skills: ["Go", "PostgreSQL"], seniority: "senior", roleFamily: "backend" };

test("POST /api/match answers an engine overload as 503 ENGINE_BUSY, not 500 MATCH_RUN_FAILED", async () => {
  const { status, json } = await withEngineFull(() =>
    post(matchRoute.POST as unknown as Post, "/api/match", { candidate: CANDIDATE }),
  );
  assert.equal(status, 503);
  assert.equal(json.code, "ENGINE_BUSY");
});

test("POST /api/match/reasoning answers it as 503 ENGINE_BUSY, not MATCH_REASONING_FAILED", async () => {
  const { status, json } = await withEngineFull(() =>
    post(reasoningRoute.POST as unknown as Post, "/api/match/reasoning", { jobId: "job-engine-busy", candidate: CANDIDATE }),
  );
  assert.equal(status, 503);
  assert.equal(json.code, "ENGINE_BUSY");
});

test("POST /api/profile/draft answers it as 503 ENGINE_BUSY, not PROFILE_DRAFT_FAILED", async () => {
  const { status, json } = await withEngineFull(() =>
    post(draftRoute.POST as unknown as Post, "/api/profile/draft", { text: "Senior Go engineer, eight years, Brno." }),
  );
  assert.equal(status, 503);
  assert.equal(json.code, "ENGINE_BUSY");
});

test("/api/matrix reads the same predicate before its catch-all", () => {
  // The grid needs a seeded profile pool to reach its spawn; the behaviour is the three
  // cases above, so this pins that the fourth door took the same branch.
  const src = readFileSync(path.join(HERE, "..", "matrix", "route.ts"), "utf8").replace(/\r\n/g, "\n");
  assert.match(
    src,
    /const busy = engineRefusal\(error\);\s*\n\s*if \(busy\) return jsonRefusal\(busy\.code, busy\.status\);\s*\n[\s\S]{0,300}?safeJsonError\(error, "api:matrix", "MATRIX_BUILD_FAILED"\)/,
  );
});
