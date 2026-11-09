import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const SCRIPT = path.resolve("scripts/perf/run-beside.mjs");

function sandbox(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kp-run-beside-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** A command line running `body` as a script of its own; no shell quoting of the body. */
function command(dir, name, body) {
  const file = path.join(dir, `${name}.mjs`);
  fs.writeFileSync(file, `import fs from "node:fs";\n${body}\n`);
  return `"${process.execPath}" "${file}"`;
}

function runBeside(dir, first, second, env = {}) {
  return spawnSync(process.execPath, [SCRIPT, "--after-write", path.join(dir, "gen.ts"), first, second], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

test("the second command starts only after the first has written the barrier file", (t) => {
  const dir = sandbox(t);
  const gen = JSON.stringify(path.join(dir, "gen.ts"));
  const seen = JSON.stringify(path.join(dir, "seen.txt"));
  fs.writeFileSync(path.join(dir, "gen.ts"), "old");
  const first = command(dir, "first", `setTimeout(() => fs.writeFileSync(${gen}, "new"), 400);`);
  const second = command(dir, "second", `fs.writeFileSync(${seen}, fs.readFileSync(${gen}, "utf8"));`);
  const res = runBeside(dir, first, second);
  assert.equal(res.status, 0, res.stdout + res.stderr);
  assert.equal(fs.readFileSync(path.join(dir, "seen.txt"), "utf8"), "new");
});

test("a failing second command fails the run", (t) => {
  const dir = sandbox(t);
  const gen = JSON.stringify(path.join(dir, "gen.ts"));
  const res = runBeside(dir, command(dir, "first", `fs.writeFileSync(${gen}, "x");`), command(dir, "second", "process.exit(3);"));
  assert.equal(res.status, 3, res.stdout + res.stderr);
});

test("a first command that dies before the barrier fails the run and the second still reports", (t) => {
  const dir = sandbox(t);
  const seen = JSON.stringify(path.join(dir, "seen.txt"));
  const res = runBeside(dir, command(dir, "first", "process.exit(4);"), command(dir, "second", `fs.writeFileSync(${seen}, "ran");`));
  assert.equal(res.status, 4, res.stdout + res.stderr);
  assert.equal(fs.readFileSync(path.join(dir, "seen.txt"), "utf8"), "ran");
});

test("a barrier that never trips cannot hang the job", (t) => {
  const dir = sandbox(t);
  const first = command(dir, "first", "setTimeout(() => {}, 1500);");
  const res = runBeside(dir, first, command(dir, "second", ""), { KP_RUN_BESIDE_BARRIER_MS: "200" });
  assert.equal(res.status, 0, res.stdout + res.stderr);
  assert.match(res.stdout, /starting anyway/);
});

test("output is labelled per command, and a wrong invocation is refused", (t) => {
  const dir = sandbox(t);
  const gen = JSON.stringify(path.join(dir, "gen.ts"));
  const res = runBeside(dir, command(dir, "first", `console.log("alpha"); fs.writeFileSync(${gen}, "x");`), command(dir, "second", ""));
  assert.match(res.stdout, /\] alpha/);
  const refused = spawnSync(process.execPath, [SCRIPT, "npm run typecheck"], { encoding: "utf8" });
  assert.equal(refused.status, 2);
});

// Coupling to the real tree: the barrier means "generation is over" only while it names the file
// codegen writes LAST, and ci.yml must keep naming that one.
test("ci.yml's barrier is the file the codegen writes last", () => {
  const codegen = fs.readFileSync("pipeline/jobfit/codegen.py", "utf8");
  const tuple = /_GENERATED = \(([\s\S]*?)\n\)/.exec(codegen)?.[1] ?? "";
  const last = [...tuple.matchAll(/\((\w+),/g)].at(-1)?.[1];
  assert.ok(last, "could not read _GENERATED from codegen.py");
  const assignment = new RegExp(`^${last} = .*?"([^"]+\\.generated\\.ts)"`, "m").exec(codegen);
  assert.ok(assignment, `could not find where codegen.py assigns ${last}`);
  const ci = fs.readFileSync(".github/workflows/ci.yml", "utf8");
  const barrier = /run-beside\.mjs --after-write (\S+) /.exec(ci)?.[1];
  assert.ok(barrier, "ci.yml no longer runs run-beside.mjs");
  assert.equal(path.posix.basename(barrier), assignment[1]);
});
