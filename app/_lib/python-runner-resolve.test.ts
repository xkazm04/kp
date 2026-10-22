// The runtime's interpreter resolver (resolvePythonCandidate in python-runner.ts).
//
// It mirrors scripts/schemas-gen.mjs except in override order: a named override
// (PYTHON_CMD, then KP_PYTHON - schemas-gen reads KP_PYTHON first; the runtime keeps a
// test's PYTHON_CMD stand-in on top) wins outright without a probe; otherwise the platform's candidates are probed with
// `--version` in order, the first at 3.11+ wins and is cached for the process, and a
// Windows Store `python` placeholder (on PATH, exits non-zero) is skipped.
//
// Pure: the probe is injected, nothing is spawned.
// Run: node scripts/run-unit-tests.mjs "app/_lib/python-runner-resolve.test.ts"
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.KP_LLM_USAGE_LOG = "0";
const {
  resolvePythonCandidate,
  pythonAutoCandidates,
  parsePythonVersion,
  PYTHON_NOT_FOUND_SENTENCE,
} = await import("./python-runner.ts");
type Cache = Parameters<typeof resolvePythonCandidate>[0]["cache"];
type ProbeResult = ReturnType<Parameters<typeof resolvePythonCandidate>[0]["probe"]>;

/** A probe scripted by "cmd argv" key; records every call. Unknown keys are ENOENT. */
function scriptedProbe(table: Record<string, ProbeResult>) {
  const calls: string[] = [];
  const probe = (cmd: string, args: string[]): ProbeResult => {
    const key = [cmd, ...args].join(" ");
    calls.push(key);
    return table[key] ?? { status: null, error: Object.assign(new Error(`spawn ${cmd} ENOENT`), { code: "ENOENT" }) };
  };
  return { probe, calls };
}

const ok = (version: string): ProbeResult => ({ status: 0, stdout: `Python ${version}\n`, stderr: "" });
// What the Windows Store App Execution Alias prints when Python is not installed.
const STORE_PLACEHOLDER: ProbeResult = {
  status: 9009,
  stdout: "",
  stderr: "Python was not found; run without arguments to install from the Microsoft Store, or disable this shortcut from Settings > Apps > Advanced app settings > App execution aliases.\r\n",
};

test("Windows tries python, python3, then py -3, in that order", () => {
  assert.deepEqual(
    pythonAutoCandidates("win32").map((c) => [c.cmd, ...c.prefixArgs].join(" ")),
    ["python", "python3", "py -3"],
  );
  const { probe, calls } = scriptedProbe({ "py -3 --version": ok("3.12.4") });
  const got = resolvePythonCandidate({ env: {}, platform: "win32", probe, cache: {} });
  assert.deepEqual(got, { cmd: "py", prefixArgs: ["-3"] });
  assert.deepEqual(calls, ["python --version", "python3 --version", "py -3 --version"]);
});

test("POSIX tries python3 before python and stops at the first hit", () => {
  const { probe, calls } = scriptedProbe({ "python3 --version": ok("3.11.9"), "python --version": ok("3.13.0") });
  const got = resolvePythonCandidate({ env: {}, platform: "linux", probe, cache: {} });
  assert.equal(got?.cmd, "python3");
  assert.deepEqual(calls, ["python3 --version"]);
});

test("the Windows Store placeholder is skipped, not chosen", () => {
  const { probe } = scriptedProbe({ "python --version": STORE_PLACEHOLDER, "py -3 --version": ok("3.12.1") });
  const got = resolvePythonCandidate({ env: {}, platform: "win32", probe, cache: {} });
  assert.equal(got?.cmd, "py");
});

test("an interpreter below 3.11, or one with no version banner, does not qualify", () => {
  const { probe } = scriptedProbe({
    "python --version": ok("3.10.12"),
    "python3 --version": { status: 0, stdout: "", stderr: "" },
    "py -3 --version": ok("3.11.0"),
  });
  assert.equal(resolvePythonCandidate({ env: {}, platform: "win32", probe, cache: {} })?.cmd, "py");
  assert.equal(parsePythonVersion("Python 2.7.18"), 207);
  assert.equal(parsePythonVersion("nope"), null);
});

test("a banner on stderr (old interpreters) is still read", () => {
  const { probe } = scriptedProbe({ "python3 --version": { status: 0, stdout: "", stderr: "Python 3.12.0" } });
  assert.equal(resolvePythonCandidate({ env: {}, platform: "darwin", probe, cache: {} })?.cmd, "python3");
});

test("a named override wins outright and is not probed: PYTHON_CMD over KP_PYTHON", () => {
  const { probe, calls } = scriptedProbe({ "python3 --version": ok("3.12.0") });
  const cache: Cache = {};
  // A test's PYTHON_CMD stand-in must survive a KP_PYTHON exported for schemas-gen.
  assert.deepEqual(
    resolvePythonCandidate({ env: { PYTHON_CMD: "C:\\Py312\\python.exe", KP_PYTHON: "other" }, platform: "win32", probe, cache }),
    { cmd: "C:\\Py312\\python.exe", prefixArgs: [] },
  );
  assert.deepEqual(
    resolvePythonCandidate({ env: { KP_PYTHON: " /opt/py/bin/python3 " }, platform: "linux", probe, cache }),
    { cmd: "/opt/py/bin/python3", prefixArgs: [] },
  );
  // A blank override is no override, and falls through to the next name.
  assert.equal(resolvePythonCandidate({ env: { PYTHON_CMD: "  ", KP_PYTHON: "kp" }, platform: "linux", probe, cache })?.cmd, "kp");
  assert.equal(resolvePythonCandidate({ env: { PYTHON_CMD: "  " }, platform: "linux", probe, cache })?.cmd, "python3");
  assert.deepEqual(calls, ["python3 --version"], "only the blank-override case probed");
});

test("the override is read per call, even after a winner is cached", () => {
  const { probe } = scriptedProbe({ "python3 --version": ok("3.12.0") });
  const cache: Cache = {};
  assert.equal(resolvePythonCandidate({ env: {}, platform: "linux", probe, cache })?.cmd, "python3");
  assert.equal(resolvePythonCandidate({ env: { PYTHON_CMD: "stand-in" }, platform: "linux", probe, cache })?.cmd, "stand-in");
});

test("the winner is probed once and cached for every later spawn", () => {
  const { probe, calls } = scriptedProbe({ "python3 --version": ok("3.12.0") });
  const cache: Cache = {};
  for (let i = 0; i < 5; i++) {
    assert.equal(resolvePythonCandidate({ env: {}, platform: "win32", probe, cache })?.cmd, "python3");
  }
  assert.deepEqual(calls, ["python --version", "python3 --version"], "five resolutions, one probe pass");
});

test("a miss returns null and is not cached, so a later install is picked up", () => {
  let installed = false;
  const probe = (cmd: string): ProbeResult => {
    if (installed && cmd === "python") return ok("3.12.0");
    return cmd === "python" ? STORE_PLACEHOLDER : { status: null, error: new Error("ENOENT") };
  };
  const cache: Cache = {};
  assert.equal(resolvePythonCandidate({ env: {}, platform: "win32", probe, cache }), null);
  assert.equal(cache.winner, undefined);
  installed = true;
  assert.equal(resolvePythonCandidate({ env: {}, platform: "win32", probe, cache })?.cmd, "python");
});

test("a probe that throws is treated as an absent candidate", () => {
  const probe = (cmd: string): ProbeResult => {
    if (cmd === "python3") throw new Error("EPERM");
    return ok("3.12.0");
  };
  assert.equal(resolvePythonCandidate({ env: {}, platform: "linux", probe, cache: {} })?.cmd, "python");
});

test("the not-found sentence names the floor, the fix and the override", () => {
  assert.match(PYTHON_NOT_FOUND_SENTENCE, /Python 3\.11\+/);
  assert.match(PYTHON_NOT_FOUND_SENTENCE, /python\.org/);
  assert.match(PYTHON_NOT_FOUND_SENTENCE, /KP_PYTHON/);
});
