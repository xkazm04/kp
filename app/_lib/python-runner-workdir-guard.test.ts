// The jobfit workdir guard: the only directories a Python run may read its inputs
// from, and the only directories cleanupWorkdir may delete, are the ones
// createWorkdir made — direct children of the OS temp dir named `jobfit-*`.
//
// Before this guard, POST /api/tasks accepted kind "analyze" with client-supplied
// params: runAnalyze read every `cvPath` it was handed (an arbitrary file read, sent
// on to the analysis) and its `finally` ran rm(baseDir, {recursive, force}) on the
// caller's path — any signed-in session (anyone, on an open deploy) could delete a
// directory the server process can write.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { assertConfinedToWorkdir, cleanupWorkdir, createWorkdir, isJobfitWorkdir } from "./python-runner.ts";

const made: string[] = [];
after(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true });
});

test("only a direct jobfit-* child of the OS temp dir is a workdir", async () => {
  const wd = await createWorkdir();
  made.push(wd);
  assert.equal(isJobfitWorkdir(wd), true);
  assert.equal(isJobfitWorkdir(os.tmpdir()), false, "the temp dir itself");
  assert.equal(isJobfitWorkdir(path.join(wd, "sub")), false, "a path inside a workdir is not a workdir");
  assert.equal(isJobfitWorkdir(path.join(wd, "..", "..")), false, "a traversal out of one");
  assert.equal(isJobfitWorkdir(path.join(os.tmpdir(), "notjobfit-x")), false, "wrong prefix");
  assert.equal(isJobfitWorkdir(process.cwd()), false, "the repository");
  assert.equal(isJobfitWorkdir(""), false);
  assert.equal(isJobfitWorkdir(undefined), false);
  assert.equal(isJobfitWorkdir(42), false);
});

test("cleanupWorkdir deletes a real workdir and REFUSES anything else", async () => {
  const wd = await createWorkdir();
  writeFileSync(path.join(wd, "cv.pdf"), "x");
  await cleanupWorkdir(wd);
  assert.equal(existsSync(wd), false, "a real workdir is cleaned up as before");

  const victim = mkdtempSync(path.join(os.tmpdir(), "kp-victim-"));
  made.push(victim);
  writeFileSync(path.join(victim, "keep.txt"), "precious");
  await cleanupWorkdir(victim);
  assert.equal(existsSync(path.join(victim, "keep.txt")), true, "a non-workdir path must survive cleanupWorkdir");
});

test("analyze params must stay inside a real workdir", async () => {
  const wd = await createWorkdir();
  made.push(wd);
  const inside = path.join(wd, "cv-0.pdf");
  assert.doesNotThrow(() => assertConfinedToWorkdir(wd, [inside, null, undefined]));

  assert.throws(() => assertConfinedToWorkdir(process.cwd(), [path.join(process.cwd(), "package.json")]), /ANALYZE_PARAMS_UNCONFINED/, "baseDir is not a workdir");
  assert.throws(() => assertConfinedToWorkdir(wd, [path.join(process.cwd(), "package.json")]), /ANALYZE_PARAMS_UNCONFINED/, "a file outside the workdir");
  assert.throws(() => assertConfinedToWorkdir(wd, [path.join(wd, "..", "other", "cv.pdf")]), /ANALYZE_PARAMS_UNCONFINED/, "a traversal out of the workdir");
  assert.throws(() => assertConfinedToWorkdir(wd, [42 as unknown as string]), /ANALYZE_PARAMS_UNCONFINED/, "a non-string path");
  mkdirSync(path.join(wd, "nested"));
  assert.doesNotThrow(() => assertConfinedToWorkdir(wd, [path.join(wd, "nested", "jd.txt")]), "a nested file inside is fine");
});
