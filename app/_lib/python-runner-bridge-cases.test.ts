// The bridge's two readers, run over the case table the Python CLI tests share.
//
// Every CLI in pipeline/jobfit exists to be read by ONE program: this bridge. Its
// readers (parsePythonJson for stdout, parseStderrError for the error envelope) are
// what a route actually receives. The Python suites used to assert on readers of their
// own — whole-stdout json.loads (an empty stdout read as {}), a strict last line, an
// inline re-parse of stderr — so a test could be stricter than production in one place
// and looser in another. They now read through a PORT of these two functions
// (pipeline/jobfit/tests/_helpers.py: read_stdout_payload / read_stderr_envelope).
//
// This file is the port's anchor. It runs the real TS readers over
// pipeline/jobfit/tests/fixtures/bridge_read_cases.json; test_bridge_reader.py runs the
// port over the same rows. A reader changed on one side only turns one suite red.
//
// Runner: Node's built-in test runner with type stripping. npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const { parsePythonJson, parseStderrError } = await import("./python-runner.ts");

type StdoutCase = { name: string; stdout: string; expect: { payload?: unknown; error?: true } };
type StderrCase = {
  name: string;
  stderr: string;
  exit: number | null;
  expect: { envelope: { message: string; status: number; code: string } };
};

const TABLE = fileURLToPath(new URL("../../pipeline/jobfit/tests/fixtures/bridge_read_cases.json", import.meta.url));
const CASES = JSON.parse(readFileSync(TABLE, "utf8")) as { stdout: StdoutCase[]; stderr: StderrCase[] };

test("the case table is non-trivial on both streams", () => {
  // Non-vacuity: an emptied table would leave both suites green over nothing.
  assert.ok(CASES.stdout.length >= 10, `stdout rows: ${CASES.stdout.length}`);
  assert.ok(CASES.stderr.length >= 15, `stderr rows: ${CASES.stderr.length}`);
  assert.ok(CASES.stdout.some((c) => c.expect.error), "at least one stdout row must be a read failure");
  assert.ok(CASES.stdout.some((c) => "payload" in c.expect), "at least one stdout row must read a payload");
});

for (const row of CASES.stdout) {
  test(`stdout: ${row.name}`, () => {
    if (row.expect.error) {
      assert.throws(() => parsePythonJson(row.stdout), /non-JSON output/);
    } else {
      assert.ok("payload" in row.expect, "a stdout row expects a payload or an error");
      assert.deepEqual(parsePythonJson(row.stdout), row.expect.payload);
    }
  });
}

for (const row of CASES.stderr) {
  test(`stderr: ${row.name}`, () => {
    assert.deepEqual(parseStderrError(row.stderr, row.exit), row.expect.envelope);
  });
}
