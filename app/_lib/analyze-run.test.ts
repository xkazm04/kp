// The analyze run's two unpriced decisions: WHEN we stop waiting for the engine, and
// WHEN the recruiter's plan is charged.
//
// 1. THE DEADLINE. `runAnalyze` passed no `timeoutMs`, so every CV analysis inherited
//    python-runner's 600 000 ms HANG BACKSTOP. That was survivable while a spawn was
//    just a process; it is not now that spawns run under a process-wide admission
//    semaphore (KP_PYTHON_MAX_CONCURRENT, default 4) — ONE wedged analysis held a
//    QUARTER of the box's engine concurrency for ten minutes and answered every other
//    caller with ENGINE_BUSY. And when it finally gave up, what reached the recruiter
//    was the child's own command line.
// 2. THE DEBIT. `recordMeterUsage("ai_candidates")` ran BEFORE `persistAnalysis`, so a
//    persist failure — the branch that logs "Failed to persist analysis" and returns
//    `persistence: null` — still spent a unit of a prepaid plan on a result that
//    reached no History row and no report. The meter ledger is append-only: there is
//    no refund path, so the ordering IS the fix.
//
// Drives the REAL runAnalyze against a throwaway DB with a FAKE spawn. testing/unit-db.ts
// MUST be the first project import (it sets KP_DB_PATH before any db-path import).
// Run: node scripts/run-unit-tests.mjs "app/_lib/analyze-run.test.ts"
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));

// ---- the fake spawn ---------------------------------------------------------
// python-runner forks CPython; that does not belong in a unit test, and the deadline it
// reports cannot be waited out. So the module is replaced by a virtual twin whose ONE
// knob is what the next spawn does. The deadline's message SHAPE is not invented here —
// it is asserted against python-runner's real source below, which is what keeps this
// from being a test of its own fake.
type SpawnScript = { kind: "ok"; payload: unknown } | { kind: "timeout" } | { kind: "fault"; message: string };
let nextSpawn: SpawnScript = { kind: "fault", message: "no spawn scripted" };
let spawnCalls: { args: string[]; timeoutMs?: number }[] = [];
(globalThis as Record<string, unknown>).__kpAnalyzeSpawn = () => nextSpawn;
(globalThis as Record<string, unknown>).__kpAnalyzeRecord = (c: { args: string[]; timeoutMs?: number }) =>
  void spawnCalls.push(c);

const VIRTUAL_RUNNER = "kp-test:python-runner";
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/(^|\/)python-runner(\.ts)?$/.test(specifier)) return { url: VIRTUAL_RUNNER, shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === VIRTUAL_RUNNER) {
      return {
        format: "module",
        shortCircuit: true,
        source: [
          "export function spawnPython(args, opts = {}) {",
          "  globalThis.__kpAnalyzeRecord({ args, timeoutMs: opts.timeoutMs });",
          "  const script = globalThis.__kpAnalyzeSpawn();",
          "  if (script.kind === 'timeout') {",
          "    return { result: Promise.reject(new Error(",
          "      'Python process timed out after ' + Math.round((opts.timeoutMs ?? 0) / 1000) + 's: ' + args.join(' ')",
          "    )) };",
          "  }",
          "  if (script.kind === 'fault') return { result: Promise.reject(new Error(script.message)) };",
          "  return { result: Promise.resolve({ stdout: JSON.stringify(script.payload), stderr: '', exitCode: 0 }) };",
          "}",
          "export function parsePythonJson(stdout) { return JSON.parse(stdout); }",
          "export function parseStderrError(stderr, exitCode) {",
          "  return { message: stderr || 'fake failure', status: exitCode === 2 ? 400 : 500, code: 'engine_error' };",
          "}",
          "export async function cleanupWorkdir() {}",
          "export async function createWorkdir() { return ''; }",
          "export async function persistFile() { return ''; }",
          "export const ENGINE_BUSY_CODE = 'ENGINE_BUSY';",
          "export const PYTHON_ERROR_CODES = ['invalid_input', 'not_found', 'engine_error', 'timeout'];",
          "export function pythonSpawnLoad() { return { inFlight: 0, queued: 0, ceiling: 4 }; }",
        ].join("\n"),
      };
    }
    return nextLoad(url, context);
  },
});

const { runAnalyze, AnalyzeError, ANALYZE_TIMEOUT_CODE, ANALYZE_TIMEOUT_MESSAGE, ANALYZE_TIMEOUT_MS, settleVariants } =
  await import("./analyze-run.ts");
const { isSpawnTimeoutMessage } = await import("./intake-run.ts");
const { listAnalyses } = await import("./db/analyses.ts");
const { billingUsageFor } = await import("./db/billing.ts");
const { currentPeriod } = await import("./billing/plans.ts");
const { ensureDb } = await import("./db/core.ts");

after(() => cleanupUnitDb());

// A minimal payload that clears analysisSchema. Deliberately thin: this file is about
// ordering and deadlines, not about the analysis shape.
const PAYLOAD = {
  candidate: {
    name: "Ada L",
    rawText: "Ada Lovelace - Go, Postgres. Eight years building payment services.",
    yearsExperience: 5,
    currentSeniority: "senior",
    roleFamily: "backend",
    skills: ["go"],
    educationLevel: "bachelor",
    languages: ["en"],
    traits: [],
    evidence: [],
  },
  score: { total: 70, experience: 20, skills: 20, roleSeniority: 15, education: 8, traits: 7 },
  salary: {
    currency: "CZK",
    period: "month",
    minimum: 100000,
    maximum: 140000,
    midpoint: 120000,
    confidence: "medium",
    rationale: [],
  },
  strengths: [],
  gaps: [],
  recommendations: [],
  explanation: "A test analysis.",
  sanityChecks: [],
  metadata: { analysisEngine: "fake", textExtractor: "fake", parsingNotes: [], groundingSources: [] },
};

// Each case gets CV bytes of its own. computeCacheKey hashes the CV content, so two
// cases sharing a fixture would make the second a CACHE HIT — which delivers without
// spawning and bills nothing, quietly passing the debit assertions for the wrong reason.
function tempCv(marker: string): { baseDir: string; cvPath: string } {
  const baseDir = mkdtempSync(path.join(os.tmpdir(), "kp-analyze-run-test-"));
  const cvPath = path.join(baseDir, "cv.txt");
  writeFileSync(cvPath, `Ada Lovelace - Go, Postgres. Fixture: ${marker}.`, "utf8");
  return { baseDir, cvPath };
}

function params(label: string, baseDir: string, cvPath: string) {
  return { baseDir, grounding: false, variants: [{ label, cvPath }], requestId: `req-${label}` };
}

const usage = () => billingUsageFor("ai_candidates", currentPeriod(new Date()));

// ---- 1. the deadline --------------------------------------------------------

test("the analyze spawn is bounded by an explicit 5-minute deadline, not the 600s backstop", async () => {
  const { baseDir, cvPath } = tempCv("bounded.pdf");
  spawnCalls = [];
  nextSpawn = { kind: "ok", payload: PAYLOAD };
  await runAnalyze(params("bounded.pdf", baseDir, cvPath));
  assert.equal(spawnCalls.length, 1);
  assert.equal(
    spawnCalls[0].timeoutMs,
    ANALYZE_TIMEOUT_MS,
    "omitting timeoutMs silently inherits python-runner's ten-minute hang backstop"
  );
  // Non-vacuity: the default it would otherwise inherit really is ten minutes, and the
  // chosen bound is a real fraction of it rather than the same number renamed.
  const runnerSrc = readFileSync(path.join(HERE, "python-runner.ts"), "utf8");
  assert.match(runnerSrc, /const DEFAULT_TIMEOUT_MS = 600_000/);
  assert.ok(
    ANALYZE_TIMEOUT_MS < 600_000 && ANALYZE_TIMEOUT_MS >= 120_000,
    `expected a minutes-class bound well under the backstop, got ${ANALYZE_TIMEOUT_MS}`
  );
});

test("a hung engine is refused BY NAME (504 + ANALYZE_TIMEOUT), never as the child's command line", async () => {
  const { baseDir, cvPath } = tempCv("hung.pdf");
  nextSpawn = { kind: "timeout" };
  const err = await runAnalyze(params("hung.pdf", baseDir, cvPath)).then(
    () => null,
    (e: unknown) => e
  );
  assert.ok(err instanceof AnalyzeError, `expected an AnalyzeError, got ${String(err)}`);
  assert.equal(err.status, 504, "we stopped waiting - a gateway deadline, not a 500 fault");
  assert.equal(err.code, ANALYZE_TIMEOUT_CODE, "the refusal must be NAMED so a consumer can localize it");
  assert.equal(err.message, ANALYZE_TIMEOUT_MESSAGE);
  assert.doesNotMatch(
    err.message,
    /pipeline\.jobfit|Python process/,
    "the child's command line is never recruiter-facing text"
  );
});

test("a NON-timeout engine fault still escapes verbatim - only the deadline is relabelled", async () => {
  const { baseDir, cvPath } = tempCv("broken.pdf");
  nextSpawn = { kind: "fault", message: "spawn python3 ENOENT" };
  const err = await runAnalyze(params("broken.pdf", baseDir, cvPath)).then(
    () => null,
    (e: unknown) => e
  );
  assert.ok(err instanceof AnalyzeError);
  assert.equal(err.code, undefined, "a fault is not a decision and carries no refusal code");
  assert.equal(err.message, "spawn python3 ENOENT");
});

test("settleVariants surfaces the deadline's code from the first failure", () => {
  const decision = settleVariants([
    { label: "a", ok: false, error: ANALYZE_TIMEOUT_MESSAGE, refusal: ANALYZE_TIMEOUT_CODE, status: 504 },
  ]);
  assert.equal(decision.kind, "throw");
  assert.equal(decision.kind === "throw" && decision.refusal, ANALYZE_TIMEOUT_CODE);
});

test("ANALYZE_TIMEOUT is a declared refusal whose sentence matches the copy held here", () => {
  // The code + message are held as LITERALS in analyze-run.ts so the task runner does
  // not pull next/server in through api-response.ts. That is only safe while the two
  // copies agree: an undeclared code resolves to no errors.<CODE> key in any of the four
  // catalogs and reaches the recruiter as the client's generic fallback in every
  // language, and a drifted sentence means the task row and the client disagree.
  const responsesSrc = readFileSync(path.join(HERE, "api-response.ts"), "utf8").replace(/\r\n/g, "\n");
  const declared = responsesSrc.match(/\n\s*ANALYZE_TIMEOUT:\s*\n?\s*"([^"]+)"/);
  assert.ok(declared, "ANALYZE_TIMEOUT must exist in REFUSAL_ERRORS");
  assert.equal(declared[1], ANALYZE_TIMEOUT_MESSAGE, "the literal here and REFUSAL_ERRORS must stay equal");
});

test("the deadline is read through the ONE shared predicate, not a regex re-typed here", () => {
  const src = readFileSync(path.join(HERE, "analyze-run.ts"), "utf8").replace(/\r\n/g, "\n");
  assert.match(src, /import \{ isSpawnTimeoutMessage \} from "@\/app\/_lib\/intake-run"/);
  assert.match(src, /isSpawnTimeoutMessage\(engineMsg\)/);
  // …and the predicate really does describe what python-runner rejects with, so the fake
  // above is not the only thing this contract rests on.
  const runnerSrc = readFileSync(path.join(HERE, "python-runner.ts"), "utf8");
  assert.match(runnerSrc, /Python process timed out after \$\{Math\.round\(timeoutMs \/ 1000\)\}s/);
  assert.ok(isSpawnTimeoutMessage("Python process timed out after 300s: -m pipeline.jobfit.cli /tmp/cv.pdf"));
  assert.ok(!isSpawnTimeoutMessage("spawn python3 ENOENT"));
});

// ---- 2. the debit -----------------------------------------------------------

test("a DELIVERED, persisted analysis debits exactly one ai_candidates unit", async () => {
  const { baseDir, cvPath } = tempCv("charged.pdf");
  const before = usage();
  nextSpawn = { kind: "ok", payload: PAYLOAD };
  const out = (await runAnalyze(params("charged.pdf", baseDir, cvPath))) as { persistence: unknown };
  assert.ok(out.persistence, "the happy path still persists");
  assert.equal(usage(), before + 1, "a delivered, non-cached analysis is billable");
});

// LAST: it drops the table the earlier tests write to.
test("a PERSIST FAILURE charges nothing - the unit follows the row, not the spawn", async () => {
  const { baseDir, cvPath } = tempCv("unsaved.pdf");
  // The one honest way to make saveAnalysis throw for real rather than stubbing it: take
  // the table away. persistAnalysis catches, logs, and hands back null - exactly the
  // shape a SQLITE_FULL / corrupt-file / failed-migration produces in the field.
  ensureDb().exec("DROP TABLE analyses");
  const before = usage();
  const errors: string[] = [];
  const realError = console.error;
  console.error = (...args: unknown[]) => void errors.push(args.map((a) => String(a)).join(" "));
  let out: { persistence: unknown };
  try {
    nextSpawn = { kind: "ok", payload: PAYLOAD };
    out = (await runAnalyze(params("unsaved.pdf", baseDir, cvPath))) as { persistence: unknown };
  } finally {
    console.error = realError;
  }
  assert.equal(out.persistence, null, "the run still DELIVERS a result - only the row is lost");
  assert.ok(errors.some((e) => e.includes("Failed to persist analysis")), "…and says so in the server log");
  assert.equal(usage(), before, "NOTHING is charged for an analysis that reached no History row");
  assert.throws(() => listAnalyses(), /no such table/, "non-vacuity: the persist really did fail");
});
