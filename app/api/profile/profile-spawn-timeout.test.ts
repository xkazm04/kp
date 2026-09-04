// /api/profile spawns pipeline.jobfit.profile_cli on every build, every save and every
// edit — and passed only an AbortSignal, so the child inherited python-runner's 600s
// hang backstop. A wedged child therefore held the recruiter's Save open for TEN
// MINUTES with their unsaved intake still in the form, and when it finally gave up the
// answer was an anonymous 500 whose generic sentence offers no next step.
//
// Two things must hold, and this file pins both: the spawn is bounded by an explicit,
// NAMED 60s-class value, and overrunning it is answered by name (504 +
// PROFILE_BUILD_TIMEOUT, which useErrorMessage resolves in the reader's language)
// rather than collapsing into the catch-all.
//
// A source-shape contract, like app/_lib/applicant-profile-timeout.test.ts: waiting out
// a real 60-second deadline is not a unit test, and the recovery path it would exercise
// (python-runner rejecting `result`) is pinned directly below.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(HERE, "route.ts"), "utf8");
const runnerSrc = readFileSync(path.join(HERE, "..", "..", "_lib", "python-runner.ts"), "utf8");
const responsesSrc = readFileSync(path.join(HERE, "..", "..", "_lib", "api-response.ts"), "utf8");

test("the profile_cli spawn is bounded by an explicit 60s-class timeout, not the 600s backstop", () => {
  const declared = src.match(/const PROFILE_ROUTE_TIMEOUT_MS = ([\d_]+)/);
  assert.ok(declared, "the bound must be a named constant, not an inline literal");
  const ms = Number(declared[1].replace(/_/g, ""));
  assert.ok(ms >= 30_000 && ms <= 120_000, `expected a 60s-class bound, got ${ms}ms`);
  assert.match(
    src,
    /spawnPython\(\["-m", "pipeline\.jobfit\.profile_cli"[\s\S]{0,200}?timeoutMs: PROFILE_ROUTE_TIMEOUT_MS/,
    "the spawn must pass the bound — omitting it silently inherits the 600s default"
  );
  // Non-vacuity: the default it would otherwise inherit really is ten minutes.
  assert.match(runnerSrc, /const DEFAULT_TIMEOUT_MS = 600_000/);
});

test("a deadline is delivered as a spawn REJECTION, and the route reads it in the one shared place", () => {
  assert.match(
    runnerSrc,
    /fail\(new Error\(`Python process timed out after \$\{Math\.round\(timeoutMs \/ 1000\)\}s/,
    "python-runner must deliver a timeout by rejecting `result`, like any other spawn failure"
  );
  assert.match(
    src,
    /isSpawnTimeoutMessage\(err\.message\)/,
    "the message is read through the shared predicate, never a regex re-typed at this call site"
  );
  assert.match(
    src,
    /import \{ isSpawnTimeoutMessage \} from "@\/app\/_lib\/intake-run"/,
    "…and that predicate has exactly one home"
  );
});

test("a non-timeout rejection still escapes to the caller's catch", () => {
  // An ENOENT on PYTHON_CMD, a killed child, a workdir failure: those are faults, not
  // decisions, and must not be relabelled as "we stopped waiting".
  assert.match(
    src,
    /if \(err instanceof Error && isSpawnTimeoutMessage\(err\.message\)\) return \{ timeout: true \};\s*\n\s*throw err;/,
    "only a timeout becomes the named outcome; everything else rethrows"
  );
});

test("the overrun is answered by NAME on both write doors", () => {
  const answers = src.match(/if \("timeout" in outcome\) return jsonRefusal\("PROFILE_BUILD_TIMEOUT", 504\);/g) ?? [];
  assert.equal(answers.length, 2, "POST (create) and PUT (edit) both spawn the CLI, so both must answer it");
  // The answer must precede the generic error branch, or the outcome would be read as
  // a plain failure first and the code would never reach the editor.
  assert.ok(
    src.indexOf('if ("timeout" in outcome)') < src.indexOf('if ("error" in outcome)'),
    "the named answer comes before the generic one"
  );
});

test("PROFILE_BUILD_TIMEOUT is a declared refusal, not an invented code", () => {
  // An undeclared code resolves to no errors.<CODE> key in any of the four catalogs and
  // would reach the recruiter as the client's generic fallback in every language.
  assert.match(responsesSrc, /PROFILE_BUILD_TIMEOUT:/, "the code must exist in REFUSAL_ERRORS");
});
