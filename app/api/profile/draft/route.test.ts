// Locks the fix for bug-ui-scan-2026-07-09 (candidate-profile-job-matching #3):
// the AI profile-draft route parsed the Gemini CLI's stdout with a bare
// `JSON.parse(stdout)`. The interpreter routinely prints async-teardown chatter
// ("Event loop is closed" / a ResourceWarning) AFTER the result JSON line, so the
// bare parse threw and the route 500'd a successful — and paid — draft.
//
// The route can't be unit-driven without spawning python + a real Gemini key, so
// this is a source-level guard (same shape as app/api/llm/test/verdict.test.ts):
// it pins that this seam funnels the CLI output through parsePythonJson, exactly
// like every sibling CLI route, and never regresses to a raw parse of stdout.
//
// Non-vacuity: the `doesNotMatch(JSON.parse(stdout))` assertion FAILS against the
// pre-fix source (which contained `return NextResponse.json(JSON.parse(stdout))`),
// so it can only pass because of the fix.
//
// Runner: Node's built-in test runner with type stripping. npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function read(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
}

test("draft route parses CLI stdout via parsePythonJson, never a raw JSON.parse(stdout)", () => {
  const src = read("./route.ts");
  // The exact pre-fix hazard: a bare parse of the child's stdout chokes on trailing
  // interpreter teardown noise and 500s an otherwise-successful draft.
  assert.doesNotMatch(
    src,
    /JSON\.parse\(\s*stdout/,
    "the route must NOT call JSON.parse directly on the python stdout (teardown-noise 500)",
  );
  // It must route the successful path through the end-scanning parser, with stderr
  // for the error detail — matching profile/route.ts, match/route.ts, reasoning-run.ts.
  // `[^>]+>+` spans a nested generic like `Record<string, unknown>>` (the inner `<…>`
  // plus the two closing `>>`) before the (stdout, stderr) argument list.
  assert.match(
    src,
    /parsePythonJson<[^>]+>+\(\s*stdout,\s*stderr\s*\)/,
    "the route must shape the CLI output with parsePythonJson(stdout, stderr)",
  );
});
