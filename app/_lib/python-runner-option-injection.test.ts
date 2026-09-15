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
const { assertSpawnArgs, flagArg, spawnPython } = await import("./python-runner.ts");

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

// ─── 4. flagArg + assertSpawnArgs: hostile and valid values through a real child ──
//
// Each hostile value goes through flagArg and a real, shell-free spawn (Node as the
// interpreter again) and must come back as exactly ONE argv element, byte-for-byte.
// A shell would split on ";" or run "$(…)"; a two-element form would hand argparse a
// leading "-" as an option. Neither can happen to a single `--flag=value` element.

const ECHO_ARGV = "process.stdout.write(JSON.stringify(process.argv.slice(1)));";

async function childArgv(extra: string[]): Promise<string[]> {
  const { result } = spawnPython(["-e", ECHO_ARGV, "--", ...extra], { timeoutMs: 4000 });
  const { stdout, exitCode } = await result;
  assert.equal(exitCode, 0);
  return JSON.parse(stdout.trim()) as string[];
}

const HOSTILE: Array<[string, string]> = [
  ["leading dash", "--model adversarial-model"],
  ["bare short option", "-h"],
  ["newline", "first line\n--lang=xx"],
  ["shell metacharacters", `a; rm -rf / && echo $(whoami) | tee x > y \`id\` "q" 'q' %PATH% ^& *`],
];

for (const [name, value] of HOSTILE) {
  test(`flagArg delivers a hostile value (${name}) as one intact element`, async () => {
    const argv = await childArgv([flagArg("--message", value), "--lang=en"]);
    assert.deepEqual(argv, [`--message=${value}`, "--lang=en"]);
  });
}

test("flagArg delivers an ordinary value unchanged", async () => {
  assert.equal(flagArg("--job-id", "job-42"), "--job-id=job-42");
  const argv = await childArgv([flagArg("--job-description-text", "Senior Python engineer, Prague")]);
  assert.deepEqual(argv, ["--job-description-text=Senior Python engineer, Prague"]);
});

test("flagArg refuses a flag name that is not a literal long option", () => {
  for (const bad of ["message", "-m", "--", "--Message", "--msg x", "--msg\n--model", "--msg=1"]) {
    assert.throws(() => flagArg(bad, "v"), TypeError, `flag ${JSON.stringify(bad)} must be refused`);
  }
});

test("assertSpawnArgs refuses a non-string or NUL element and names only its position", () => {
  assert.throws(() => assertSpawnArgs(["-m", undefined]), /argument 1 is not a string/);
  assert.throws(() => assertSpawnArgs(["-m", "x\0--model secret"]), (err: Error) => {
    assert.match(err.message, /argument 1 contains a NUL byte/);
    assert.ok(!err.message.includes("secret"), "the value must not be echoed");
    return true;
  });
  assert.doesNotThrow(() => assertSpawnArgs(["-m", "pipeline.jobfit.cli", "--lang=en"]));
});

test("spawnPython rejects a NUL-bearing argv through its result, before any child starts", async () => {
  const { result } = spawnPython(["-e", ECHO_ARGV, "--", "bad\0value"], { timeoutMs: 4000 });
  await assert.rejects(result, /argument 3 contains a NUL byte/);
});

// ─── 5. Source contracts: the migrated call sites stay on the = form ─────────────

const src = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf-8");

test("spawn is pinned to shell: false", () => {
  assert.match(src("./python-runner.ts"), /\bshell: false\b/);
  assert.doesNotMatch(src("./python-runner.ts"), /\bshell: true\b/);
});

test("user-supplied values reach their CLIs through flagArg, not as a separate element", () => {
  // The lookbehind matters: `flagArg("--message", message)` itself contains
  // `"--message", message`, so only an occurrence NOT opened by `flagArg(` is the
  // two-element form.
  const cases: Array<[string, RegExp, string]> = [
    ["./devcase-run.ts", /(?<!flagArg\()"--message"\s*,\s*message\b/, 'flagArg("--message", message)'],
    ["./devcase-run.ts", /(?<!flagArg\()"--channel"\s*,\s*channel\b/, 'flagArg("--channel", channel)'],
    ["./analyze-run.ts", /(?<!flagArg\()"--job-description-text"\s*,/, 'flagArg("--job-description-text"'],
    ["./analyze-run.ts", /(?<!flagArg\()"--company-text"\s*,/, 'flagArg("--company-text"'],
    ["./reasoning-run.ts", /(?<!flagArg\()"--job-id"\s*,\s*\n?\s*String\(body\.jobId\)/, 'flagArg("--job-id", String(body.jobId))'],
    ["../api/llm/keys/test/route.ts", /(?<!flagArg\()"--model"\s*,\s*model\b/, 'flagArg("--model", model)'],
  ];
  for (const [file, twoElement, fixed] of cases) {
    const text = src(file);
    assert.doesNotMatch(text, twoElement, `${file} passes a user value as its own argv element`);
    assert.ok(text.includes(fixed), `${file} must use ${fixed}`);
  }
});
