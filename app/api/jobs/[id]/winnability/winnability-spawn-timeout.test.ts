// The winnability coach spawns pipeline.jobfit.winnability_cli on every grade and
// passed only an AbortSignal, so the child inherited python-runner's 600s hang backstop.
// The CLI is deterministic scoring with no model call — sub-second on any real pool — so
// the only thing that ten minutes could buy was a recruiter watching "Grading…" for nine
// minutes after the answer stopped being useful, and then an anonymous 500.
//
// A source-shape contract (see app/_lib/applicant-profile-timeout.test.ts): waiting out a
// real deadline is not a unit test, and the delivery mechanism it would exercise —
// python-runner rejecting `result` — is pinned here directly.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(HERE, "route.ts"), "utf8");
const LIB = path.join(HERE, "..", "..", "..", "..", "_lib");
const runnerSrc = readFileSync(path.join(LIB, "python-runner.ts"), "utf8");
const responsesSrc = readFileSync(path.join(LIB, "api-response.ts"), "utf8");

test("the winnability_cli spawn is bounded by an explicit 60s-class timeout, not the 600s backstop", () => {
  const declared = src.match(/const WINNABILITY_TIMEOUT_MS = ([\d_]+)/);
  assert.ok(declared, "the bound must be a named constant, not an inline literal");
  const ms = Number(declared[1].replace(/_/g, ""));
  assert.ok(ms >= 30_000 && ms <= 120_000, `expected a 60s-class bound, got ${ms}ms`);
  assert.match(
    src,
    /spawnPython\(\s*\[[^\]]*winnability_cli[\s\S]{0,200}?timeoutMs: WINNABILITY_TIMEOUT_MS/,
    "the spawn must pass the bound — omitting it silently inherits the 600s default"
  );
  // Non-vacuity: the default it would otherwise inherit really is ten minutes.
  assert.match(runnerSrc, /const DEFAULT_TIMEOUT_MS = 600_000/);
});

test("the AbortSignal is kept beside the bound, not replaced by it", () => {
  // The two do different jobs: the signal kills the child when the recruiter closes the
  // panel, the deadline kills it when nobody does. Losing either is a regression.
  assert.match(src, /\{ signal: request\.signal, timeoutMs: WINNABILITY_TIMEOUT_MS \}/);
});

test("an overrun is answered by name, and a real fault still is not", () => {
  assert.match(
    runnerSrc,
    /fail\(new Error\(`Python process timed out after \$\{Math\.round\(timeoutMs \/ 1000\)\}s/,
    "python-runner must deliver a timeout by rejecting `result`"
  );
  assert.match(
    src,
    /isSpawnTimeoutMessage\(error\.message\)[\s\S]{0,120}?jsonRefusal\("JOB_WINNABILITY_TIMEOUT", 504\)/,
    "a deadline WE set is a decision the reader can act on (retry), so it gets its own code"
  );
  assert.match(
    src,
    /safeJsonError\(error, "api:jobs\/winnability", "JOB_WINNABILITY_FAILED"\)/,
    "everything else is still a LOGGED fault behind the generic code — the raw message never ships"
  );
  assert.ok(
    src.indexOf("isSpawnTimeoutMessage") < src.indexOf("JOB_WINNABILITY_FAILED"),
    "the named answer must be reached before the catch-all"
  );
});

test("the timeout predicate has exactly one home", () => {
  assert.match(
    src,
    /import \{ isSpawnTimeoutMessage \} from "@\/app\/_lib\/intake-run"/,
    "read the shared predicate; never re-type its regex at a call site"
  );
});

test("JOB_WINNABILITY_TIMEOUT is a declared refusal, not an invented code", () => {
  // An undeclared code resolves to no errors.<CODE> key in the four catalogs, so the
  // coach panel would fall back to its generic English load-failure line.
  assert.match(responsesSrc, /JOB_WINNABILITY_TIMEOUT:/, "the code must exist in REFUSAL_ERRORS");
});
