// The bridge's reading of the Python error envelope. The engine now NAMES its failure
// (pipeline/jobfit/_cli.py::emit_error emits `code` chosen at the raise site); before
// that, `parseStderrError` had to guess a code back out of the HTTP-ish status, so
// "job not found" and a real engine fault reached the browser as the same anonymous
// 500 and `useErrorMessage` had nothing distinguishing to resolve.
//
// What is pinned here: the emitted code WINS over the derived one, a blank/absent
// emitted code falls back to the derivation rather than to an unresolvable "", and the
// derivation itself covers the four statuses the engine emits.
import { test } from "node:test";
import assert from "node:assert/strict";

const { parseStderrError, PYTHON_ERROR_CODES } = await import("./python-runner.ts");

function envelope(body: Record<string, unknown>): string {
  return `some warning line\n${JSON.stringify(body)}\n`;
}

test("an emitted code is preferred over the status-derived one", () => {
  // reasoning_cli / recruiter_cli raise not_found(...) → 404 + "not_found".
  const notFound = parseStderrError(envelope({ error: "job not found: j-9", status: 404, code: "not_found" }), 1);
  assert.equal(notFound.code, "not_found");
  assert.equal(notFound.status, 404);

  // The point of preferring the emission: a code the status alone could NEVER produce.
  // A 500 derives "engine_error"; the engine saying "timeout" must survive.
  const emitted = parseStderrError(envelope({ error: "provider timed out", status: 500, code: "timeout" }), 1);
  assert.equal(emitted.code, "timeout");
});

test("a blank emitted code falls back to the derivation, never to an empty code", () => {
  // An empty `code` used to pass the bare `typeof === "string"` test and win, giving
  // the client a code that resolves to no `errors.<CODE>` key at all.
  for (const blank of ["", "   ", "\t"]) {
    const err = parseStderrError(envelope({ error: "boom", status: 400, code: blank }), 1);
    assert.equal(err.code, "invalid_input", `blank code ${JSON.stringify(blank)} must not win`);
  }
  const nonString = parseStderrError(envelope({ error: "boom", status: 404, code: 42 }), 1);
  assert.equal(nonString.code, "not_found");
});

test("an emitted code is trimmed, so trailing whitespace cannot break the lookup", () => {
  const err = parseStderrError(envelope({ error: "bad json", status: 400, code: " invalid_input\n" }), 1);
  assert.equal(err.code, "invalid_input");
});

test("without an emitted code the status derives one, covering the engine's vocabulary", () => {
  const cases: Array<[number, string]> = [
    [400, "invalid_input"],
    [404, "not_found"],
    [504, "timeout"],
    [500, "engine_error"],
  ];
  for (const [status, code] of cases) {
    const err = parseStderrError(envelope({ error: "x", status }), 1);
    assert.equal(err.code, code, `status ${status}`);
    assert.ok(PYTHON_ERROR_CODES.includes(code as (typeof PYTHON_ERROR_CODES)[number]));
  }
});

test("plain-text stderr (argparse usage, a traceback) still yields a code", () => {
  const usage = parseStderrError("usage: reasoning_cli [-h]\nerror: the following arguments are required: --job-id", 2);
  assert.equal(usage.status, 400);
  assert.equal(usage.code, "invalid_input");

  const crash = parseStderrError("Traceback (most recent call last):\n  ...\nRuntimeError: nope", 1);
  assert.equal(crash.status, 500);
  assert.equal(crash.code, "engine_error");
  assert.match(crash.message, /RuntimeError: nope/);
});
