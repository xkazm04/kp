// Wrapper for the Python schema generator (`python -m pipeline.jobfit.codegen`).
//
// WHY THIS EXISTS: `schemas:gen` is the first step of BOTH `npm run typecheck` and
// `npm run build`, so it is the first thing a new contributor or a fresh CI image
// runs — and it was a bare `python -m pipeline.jobfit.codegen`. On a machine where
// the interpreter is `python3`, or where `pip install -r requirements.txt` has not
// been run, that fails as a raw shell `command not found` or a pydantic
// ModuleNotFoundError traceback under an npm exit-1 banner, naming neither the
// contract that broke nor the command that fixes it. The generator itself cannot
// say so: it has already failed to load.
//
// The wrapper adds three things and nothing else:
//   * interpreter discovery — PYTHON_CMD (the same env var app/_lib/python-runner.ts
//     honours), then the platform's usual candidates;
//   * a diagnosis on failure — missing interpreter vs missing package — each with
//     the exact command that fixes it;
//   * argv passthrough, so `--check` (npm run schemas:check) and
//     `--print-json-schema` behave exactly as before.
//
// It is idempotent: the generator rewrites app/_lib/schemas.generated.ts and
// app/_lib/taxonomy.generated.ts from the Pydantic models, so running it twice is
// the same as running it once. The exit code is the generator's own — `--check`
// still answers 1 for a stale file, which is what CI reads.
//
// Fixtures: scripts/__tests__/schemas-gen.test.mjs (run by `npm run test:docs`).
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MODULE = "pipeline.jobfit.codegen";

/** Interpreters to try, in order. PYTHON_CMD wins outright when set — an operator
 *  who names an interpreter means that one, and silently falling back to another
 *  would generate from a different environment than they asked for. */
export function pythonCandidates(env = process.env, platform = process.platform) {
  const named = env.PYTHON_CMD?.trim();
  if (named) return [named];
  return platform === "win32" ? ["python", "python3", "py"] : ["python3", "python"];
}

/** First candidate that answers `--version`. `null` when none is installed. */
export function findInterpreter(candidates, run = spawnSync) {
  for (const candidate of candidates) {
    const probe = run(candidate, ["--version"], { encoding: "utf8" });
    // ENOENT surfaces as probe.error; a shim that exists but refuses (the Windows
    // Store `python` stub answers non-zero) is treated as not installed too.
    if (!probe.error && probe.status === 0) return candidate;
  }
  return null;
}

const MISSING_PYTHON_HINT = [
  "schemas:gen could not find a Python interpreter.",
  "",
  "  This step generates app/_lib/schemas.generated.ts and taxonomy.generated.ts from",
  "  the Pydantic models in pipeline/jobfit — `npm run typecheck` and `npm run build`",
  "  both run it first, so neither can work without Python.",
  "",
  "  Install Python 3.11+ and its dependencies:",
  "    pip install -r requirements.txt",
  "  Or point the build at an interpreter you already have:",
  "    PYTHON_CMD=/path/to/python npm run schemas:gen",
].join("\n");

const missingPackageHint = (interpreter) =>
  [
    `schemas:gen ran ${interpreter} but the pipeline package is not importable.`,
    "",
    "  Install the pipeline dependencies from the repo root:",
    "    pip install -r requirements.txt",
  ].join("\n");

export function main(argv = process.argv.slice(2), { env = process.env, run = spawnSync } = {}) {
  const interpreter = findInterpreter(pythonCandidates(env), run);
  if (!interpreter) {
    process.stderr.write(`${MISSING_PYTHON_HINT}\n`);
    return 1;
  }

  const result = run(interpreter, ["-m", MODULE, ...argv], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    // UTF-8 in, UTF-8 out: the generated files carry non-ASCII and a Windows
    // default locale (cp1250) mangles them — the same reason python-runner.ts
    // pins these.
    env: { ...env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" },
  });

  if (result.error) {
    process.stderr.write(`schemas:gen could not run ${interpreter}: ${result.error.message}\n`);
    return 1;
  }
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  // A ModuleNotFoundError here is an install problem, not a codegen problem, and
  // the traceback alone does not say which requirements file to reach for.
  if (result.status !== 0 && /No module named|ModuleNotFoundError/.test(result.stderr ?? "")) {
    process.stderr.write(`\n${missingPackageHint(interpreter)}\n`);
  }
  return result.status ?? 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}
