// Option-injection regression fixtures for python-runner call sites.
//
// Background: Python argparse treats any argv element starting with "--" as a
// flag, not as a positional value. A user-supplied string like "--help" passed
// as a two-element pair ("--message", "--help") causes argparse to execute the
// --help action instead of storing the value. The fixes are:
//   • Named string args: use --flag=value form (single argv element) so argparse
//     cannot misinterpret the value as a new flag.
//   • Structured data (repoUrl, need, etc.): write to a JSON file and pass via
//     --*-json; the user value never appears as a raw CLI token.
//
// NON-VACUITY: removing the = fix in intake-run.ts makes the bare-form test
// fail, which is the whole point — CI catches a regression before prod does.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// ─── 1. Source-level contract: intake --message uses = form ──────────────────
//
// The two functions that pass a user-supplied message to intake_cli must use
// the = form ("--message=<value>") rather than the two-arg form ("--message",
// "<value>"). This test reads the source so the contract survives a refactor
// that renames a variable or restructures the args array.

const intakeRunSrc = readFileSync(
  fileURLToPath(new URL("./intake-run.ts", import.meta.url)),
  "utf-8",
);

test("intake runIntakeExchange: --message uses = form (option-injection guard)", () => {
  // The two-arg form would let a --prefixed user message be re-parsed as a flag.
  // Regexp: "--message" as a standalone string literal immediately followed (on
  // the same or next non-blank line) by a reference to input.message.
  const twoArgPattern = /"--message"\s*,\s*\n?\s*input\.message/;
  assert.ok(
    !twoArgPattern.test(intakeRunSrc),
    'runIntakeExchange must not use ("--message", input.message) two-arg form — use `--message=${input.message}` instead',
  );
});

test("intake runIntakeVoiceTurn: --message uses = form (option-injection guard)", () => {
  // Same contract for the voice-turn path.
  const twoArgPattern = /"--message"\s*,\s*\n?\s*input\.message/;
  assert.ok(
    !twoArgPattern.test(intakeRunSrc),
    'runIntakeVoiceTurn must not use ("--message", input.message) two-arg form — use `--message=${input.message}` instead',
  );
  // Positive: the = form must be present at least once.
  assert.ok(
    intakeRunSrc.includes("`--message=${input.message}`"),
    "intake-run.ts must use the = form for --message",
  );
});

// ─── 2. Source-level contract: devcase repoUrl goes through JSON files ───────
//
// User-supplied repoUrl values flow through codebaseRefs → buildRepoSnapshot →
// a JSON file passed via --snapshots-json or --need-json. The raw string never
// appears as a bare CLI token, so even "--model adversarial" cannot inject.

const devcaseRunSrc = readFileSync(
  fileURLToPath(new URL("./devcase-run.ts", import.meta.url)),
  "utf-8",
);

test("devcase runNeedAnalysis: repoUrl is serialised to a JSON file, not a bare CLI arg", () => {
  // The need object (containing codebaseRefs with the repoUrl) must be written
  // to a file and passed via --need-json, not interpolated directly into args.
  assert.ok(
    devcaseRunSrc.includes("--need-json"),
    "need (including codebaseRefs/repoUrl) must be passed via --need-json",
  );
  // Negative: there must be no pattern that pushes a raw repo URL string into
  // the args array (the only repo-shaped data goes through JSON files).
  const bareRepoUrlPattern = /args\.push\(\s*"--repo-url"\s*,/;
  assert.ok(
    !bareRepoUrlPattern.test(devcaseRunSrc),
    "repoUrl must not be pushed as a bare --repo-url string into args — use a JSON file",
  );
});

// ─── 3. Behavioural: = form keeps a --prefixed value intact ──────────────────
//
// Verify that passing "--flag=--adversarial value" as a single argv element
// preserves the full string (including leading --) as the flag's value, so the
// call site's fix actually does what it promises.
//
// Uses Node.js as the "Python interpreter" — no Python toolchain needed.

process.env.PYTHON_CMD = process.execPath;
const { spawnPython } = await import("./python-runner.ts");

test("= form passes a --prefixed user value as data, not as a new flag", async () => {
  // Verify the = form contract: "--message=--model adversarial" is passed as a
  // SINGLE argv element, so the string "--model adversarial" is the value, not
  // a new flag. Node.js serves as the Python stand-in here.
  //
  // The "--" signals end of Node flags; everything after it becomes process.argv
  // entries accessible to the -e script. spawnPython(args) calls
  // spawn(nodePath, args) without a shell, so no further splitting occurs.
  // When Node runs `-e script -- arg`, process.argv = [nodePath, arg] (no [eval]
  // slot), so slice(1) is the first script-level argument.
  const script =
    "const arg = process.argv.slice(1).find(a => a.startsWith('--message='));" +
    "process.stdout.write(JSON.stringify({ message: arg ? arg.slice('--message='.length) : null }));";
  const userValue = "--model adversarial";
  const { result } = spawnPython(["-e", script, "--", `--message=${userValue}`], { timeoutMs: 4000 });
  const { stdout, exitCode } = await result;
  assert.equal(exitCode, 0);
  const parsed = JSON.parse(stdout.trim()) as { message: string | null };
  assert.equal(
    parsed.message,
    userValue,
    "= form must deliver the user value intact, including leading --",
  );
});
