// Fixtures for scripts/schemas-gen.mjs — the wrapper in front of the Python schema
// generator that `npm run typecheck` and `npm run build` both run first.
//
// The branch worth pinning is the one nobody on a working machine ever sees: a
// checkout with no Python, or with Python but no `pip install -r requirements.txt`.
// That is the first command a new contributor runs, and before the wrapper it
// failed as a raw shell error or a pydantic traceback naming neither the contract
// nor the fix. These run the wrapper's `main()` with an injected spawn, so the
// missing-interpreter and missing-package paths are exercised on a machine where
// Python IS installed.
//
// Run: npm run test:docs
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const { main, pythonCandidates, findInterpreter } = await import("../schemas-gen.mjs");

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const WRAPPER = path.join(REPO_ROOT, "scripts", "schemas-gen.mjs");

/** Capture what the wrapper writes to stderr/stdout while `main` runs. */
function capture(fn) {
  const out = { stdout: "", stderr: "" };
  const realOut = process.stdout.write.bind(process.stdout);
  const realErr = process.stderr.write.bind(process.stderr);
  process.stdout.write = (chunk) => {
    out.stdout += chunk;
    return true;
  };
  process.stderr.write = (chunk) => {
    out.stderr += chunk;
    return true;
  };
  try {
    out.status = fn();
  } finally {
    process.stdout.write = realOut;
    process.stderr.write = realErr;
  }
  return out;
}

test("KP_PYTHON wins over PYTHON_CMD, which wins over the platform list", () => {
  // AGENTS.md documents KP_PYTHON; PYTHON_CMD is the older name python-runner.ts
  // shares. Both are honoured, the documented one first.
  assert.deepEqual(pythonCandidates({ KP_PYTHON: "/kp/py", PYTHON_CMD: "/opt/py/bin/python" }, "linux"), ["/kp/py"]);
  assert.deepEqual(pythonCandidates({ KP_PYTHON: "  ", PYTHON_CMD: "/opt/py/bin/python" }, "linux"), ["/opt/py/bin/python"]);
});

test("PYTHON_CMD wins outright; otherwise the platform's candidates are tried in order", () => {
  assert.deepEqual(pythonCandidates({ PYTHON_CMD: "/opt/py/bin/python" }, "linux"), [
    "/opt/py/bin/python",
  ]);
  // A blank PYTHON_CMD is not a choice — fall back rather than spawn "".
  assert.deepEqual(pythonCandidates({ PYTHON_CMD: "  " }, "linux"), ["python3", "python"]);
  assert.deepEqual(pythonCandidates({}, "win32"), ["python", "python3", "py"]);
  assert.deepEqual(pythonCandidates({}, "darwin"), ["python3", "python"]);
});

test("an interpreter that is absent, or a stub that refuses, is not selected", () => {
  const run = (cmd) => {
    if (cmd === "python3") return { error: Object.assign(new Error("ENOENT"), { code: "ENOENT" }) };
    if (cmd === "python") return { status: 9, stdout: "", stderr: "Microsoft Store stub" };
    return { status: 0, stdout: "Python 3.12.1\n", stderr: "" };
  };
  assert.equal(findInterpreter(["python3", "python", "py"], run), "py");
  assert.equal(findInterpreter(["python3", "python"], run), null);
});

test("no interpreter at all: exit 1 with the install hint, and codegen is never spawned", () => {
  let codegenSpawns = 0;
  const run = (_cmd, args) => {
    if (args?.[0] === "-m") codegenSpawns += 1;
    return { error: Object.assign(new Error("ENOENT"), { code: "ENOENT" }) };
  };
  const res = capture(() => main([], { env: {}, run }));

  assert.equal(res.status, 1, "a missing interpreter must fail the step");
  assert.equal(codegenSpawns, 0, "nothing to run the module with — do not try");
  assert.match(res.stderr, /could not find a Python interpreter/);
  assert.match(res.stderr, /pip install -r requirements\.txt/, "the hint must name the fix");
  assert.match(res.stderr, /KP_PYTHON=/, "the hint must name the documented override");
  assert.match(res.stderr, /PYTHON_CMD/, "and still mention the older name");
});

test("interpreter present, package missing: the traceback is kept AND the install hint added", () => {
  const run = (_cmd, args) =>
    args?.[0] === "--version"
      ? { status: 0, stdout: "Python 3.12.1\n", stderr: "" }
      : {
          status: 1,
          stdout: "",
          stderr: "ModuleNotFoundError: No module named 'pydantic'\n",
        };
  const res = capture(() => main([], { env: { PYTHON_CMD: "python" }, run }));

  assert.equal(res.status, 1);
  assert.match(res.stderr, /No module named 'pydantic'/, "never swallow the real error");
  assert.match(res.stderr, /pipeline package is not importable/);
  assert.match(res.stderr, /pip install -r requirements\.txt/);
});

test("argv passes straight through, so --check keeps its exit-code contract", () => {
  let seen = null;
  const run = (_cmd, args) => {
    if (args?.[0] === "--version") return { status: 0, stdout: "Python 3.12.1\n", stderr: "" };
    seen = args;
    return { status: 1, stdout: "", stderr: "app/_lib/schemas.generated.ts out of date.\n" };
  };
  const res = capture(() => main(["--check"], { env: { PYTHON_CMD: "python" }, run }));

  assert.deepEqual(seen, ["-m", "pipeline.jobfit.codegen", "--check"]);
  assert.equal(res.status, 1, "--check must still answer non-zero for a stale file");
  // A stale-file failure is NOT an install problem: do not bury it under the hint.
  assert.doesNotMatch(res.stderr, /pip install/);
});

test("a real run is idempotent: --check is clean straight after a generate", (t) => {
  const probe = spawnSync(process.execPath, [WRAPPER, "--check"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  // No Python on this machine (the branch above already covers the message) — the
  // end-to-end half of the fixture cannot run, and pretending it passed would be
  // worse than saying so.
  if (probe.status === 1 && /could not find a Python interpreter/.test(probe.stderr)) {
    t.skip("no Python interpreter available");
    return;
  }
  const generated = spawnSync(process.execPath, [WRAPPER], { cwd: REPO_ROOT, encoding: "utf8" });
  assert.equal(generated.status, 0, generated.stderr);
  const after = spawnSync(process.execPath, [WRAPPER, "--check"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  assert.equal(after.status, 0, `--check is stale right after a generate:\n${after.stderr}`);
});
