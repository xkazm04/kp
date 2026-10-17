// runJobfitCli: the single spawn envelope. Hermetic, `node` stands in for Python.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";

process.env.PYTHON_CMD = process.execPath;
const { runJobfitCli, PipelineError } = await import("./python-runner.ts");

test("runs the CLI, feeds it the input files, parses stdout and removes the workdir", async () => {
  let seenDir = "";
  const out = await runJobfitCli<{ echoed: { a: number } }>(
    (paths, workdir) => {
      seenDir = workdir;
      return [
        "-e",
        `const fs=require('fs');process.stdout.write(JSON.stringify({echoed:JSON.parse(fs.readFileSync(process.argv[1],'utf8'))}))`,
        paths.job,
      ];
    },
    { inputs: { job: { a: 7 } }, timeoutMs: 20_000 },
  );
  assert.deepEqual(out, { echoed: { a: 7 } });
  assert.ok(seenDir && !existsSync(seenDir), "workdir removed after success");
});

test("a non-zero exit throws PipelineError and still removes the workdir", async () => {
  // Check this call's own workdir: sibling test files create and remove their own
  // jobfit-* dirs in the same tmpdir concurrently, so a tmpdir diff reads them as leaks.
  let seenDir = "";
  await assert.rejects(
    runJobfitCli(
      (_paths, workdir) => {
        seenDir = workdir;
        return ["-e", "process.stderr.write('boom');process.exit(3)"];
      },
      { timeoutMs: 20_000 },
    ),
    (e: unknown) => e instanceof PipelineError,
  );
  assert.ok(seenDir, "args callback received the workdir");
  assert.ok(!existsSync(seenDir), "no leaked workdir");
});

test("the required deadline is enforced (a hung child is killed, not awaited for 10 minutes)", async () => {
  const started = Date.now();
  await assert.rejects(runJobfitCli(["-e", "setTimeout(()=>{},60000)"], { timeoutMs: 300 }));
  assert.ok(Date.now() - started < 15_000);
});

test("parse narrows the envelope at the boundary", async () => {
  const out = await runJobfitCli(["-e", "process.stdout.write('{\"n\":2}')"], {
    timeoutMs: 20_000,
    parse: (raw) => (raw as { n: number }).n * 2,
  });
  assert.equal(out, 4);
});
