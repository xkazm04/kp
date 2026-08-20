import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Source guard (kp convention: a regex test over the source, since a route handler
// needs the Next request/DB runtime and isn't unit-loadable).
//
// The abandoned-request contract: every route that spawns a Python child forwards
// `request.signal` into spawnPython, so closing the tab / navigating away SIGKILLs
// the child instead of orphaning it to python-runner's 600s backstop while it holds
// a temp workdir. /api/match and /api/matrix both do it (with the same comment);
// this route — the LLM-backed, most expensive of the three — passed a literal
// `undefined` into runReasoning's `signal` slot and was the sole outlier.
//
// The signal is right HERE specifically because this is the SYNCHRONOUS convenience
// wrapper: the survive-navigation path is /api/tasks with kind "reasoning", which
// passes the TASK's own signal (tasks.ts) precisely so a refresh doesn't kill it.
const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "route.ts"), "utf8");

test("the reasoning route forwards the request's abort signal into runReasoning", () => {
  assert.match(
    src,
    /runReasoning\([^)]*request\.signal/,
    "runReasoning must receive request.signal so an abandoned request kills the Python child"
  );
  // Forbid the old form outright: an `undefined` in the signal slot is the exact
  // regression this guard exists to catch.
  assert.doesNotMatch(
    src,
    /runReasoning\(\s*\{[^}]*\}\s*,\s*undefined/,
    "the signal argument must not be `undefined` — that orphans the child to the 600s backstop"
  );
});
