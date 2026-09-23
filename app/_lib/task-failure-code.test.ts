// A failed task row stores a CODE for every failure the runtime itself authored, and
// every surface that shows the row resolves it in the reader's language.
//
// Before: the task runner stored `error.message` on the row and five surfaces printed it
// as-is. For the engine's own failures that is English runtime text ("Python process
// timed out after 240s", "The analysis engine is busy right now…"), and the runner added
// English of its own ("exceeded the 900000ms wall-clock budget", "unknown kind x",
// "reaped: running past the wall-clock budget with no live handler"). A Czech recruiter
// read all of it in English, in the Tasks drawer and the Activity detail alike.
//
// Now the runner's failures are typed (SpawnFailure, ENGINE_BUSY), so the row keeps the
// code (spawnFailureCode) and the runner's own outcomes are codes too; the surfaces run
// the stored value through the errors catalog (useErrorMessage), falling back to the
// stored text for a handler's own message or a row written before this change.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

process.env.PYTHON_CMD = process.execPath;
process.env.KP_LLM_USAGE_LOG = "0";
const runner = (await import("./python-runner.ts")) as typeof import("./python-runner.ts") & {
  spawnFailureCode?: (err: unknown) => string | null;
};
const { PipelineError, SpawnFailure, ENGINE_BUSY_CODE } = runner;

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf-8");

/** Every code a task row can now carry from the runtime's own failures. */
const RUNTIME_CODES = ["ENGINE_BUSY", "ENGINE_TIMEOUT", "ENGINE_FAILED", "TASK_TIME_LIMIT", "TASK_KIND_UNKNOWN"];

test("spawnFailureCode names every runner failure and nothing else", () => {
  assert.equal(typeof runner.spawnFailureCode, "function", "spawnFailureCode is exported");
  const code = runner.spawnFailureCode!;
  const busy = new PipelineError({ message: "busy", status: 503, code: ENGINE_BUSY_CODE });
  assert.equal(code(busy), "ENGINE_BUSY");
  assert.equal(code(new SpawnFailure("timeout", "Python process timed out after 240s")), "ENGINE_TIMEOUT");
  assert.equal(code(new SpawnFailure("output_overflow", "x")), "ENGINE_FAILED");
  assert.equal(code(new SpawnFailure("spawn_failed", "x")), "ENGINE_FAILED");
  assert.equal(code(new SpawnFailure("aborted", "x")), "ENGINE_FAILED");
  assert.equal(code(new Error("boom")), null, "a handler's own error keeps its own text");
  assert.equal(code(new PipelineError({ message: "bad", status: 400, code: "invalid_input" })), null, "a CLI's envelope is not the runner's");
  assert.equal(code("nope"), null);
});

test("every runtime failure code resolves in all four catalogs and is a registered refusal", () => {
  const registry = read("app/_lib/api-response.ts");
  const refusals = registry.slice(registry.indexOf("export const REFUSAL_ERRORS"));
  for (const c of RUNTIME_CODES) {
    assert.match(refusals, new RegExp(`\\n  ${c}: "`), `${c} is in REFUSAL_ERRORS`);
    for (const locale of ["en", "cs", "de", "fr"]) {
      const errors = (JSON.parse(read(`messages/${locale}.json`)) as { errors: Record<string, unknown> }).errors;
      assert.equal(typeof errors[c], "string", `messages/${locale}.json errors.${c}`);
    }
  }
});

test("the task runner stores codes, not English sentences, for the failures it authors", () => {
  const src = read("app/_lib/tasks.ts");
  const stored = [...src.matchAll(/finishTask\([^;]*?\{\s*error:\s*([^}]*?)\s*\}\s*\)/g)].map((m) => m[1]);
  assert.ok(stored.length >= 4, `found the finishTask error writes (${stored.length})`);
  for (const value of stored) {
    assert.doesNotMatch(value, /^[`"'][a-z]/, `a lower-case sentence is stored on the row: ${value}`);
  }
  assert.match(src, /spawnFailureCode\(error\)/, "a thrown runner failure is stored as its code");
  assert.doesNotMatch(src, /wall-clock budget with no live handler"|unknown kind \$\{/, "the old English outcomes are gone");
});

test("every surface that shows a stored task error resolves it through the errors catalog", () => {
  // The surfaces that print the row's `error` to a reader. Each resolves the stored
  // value as a code first (useErrorMessage / the analyze resolver's apiCode) and keeps
  // the stored text as the fallback for a handler's own message.
  const surfaces: [string, RegExp][] = [
    ["app/features/shell/tasks/TasksTableRow.tsx", /resolveError\(\{ code: task\.error \}, task\.error\)/],
    ["app/features/insights/activity/ActivityDetailModal.tsx", /resolveError\(\{ code: task\.error \}, task\.error\)/],
    ["app/features/tools/profile/ProfileEditorAiDraft.tsx", /resolveError\(\{ code: watch\.error \}, watch\.error\)/],
    ["app/features/jobseeker/ScanNowButton.tsx", /resolveError\(\{ code: scan\.error \}, scan\.error\)/],
    ["app/features/tools/analyze/AnalyzeApi.ts", /new AnalyzeClientError\("errIncomplete", task\.error, task\.error\)/],
  ];
  for (const [file, shape] of surfaces) assert.match(read(file), shape, `${file} resolves the stored code`);
});
