import { test } from "node:test";
import assert from "node:assert/strict";
import { seedDiffEvidence, unionChangedPaths } from "./devcase-seed-diff.ts";

const seed = [{ path: "src/config.ts" }, { path: "src/legacy/adapter.ts" }, { path: "DECISIONS.md" }, { path: "README.md" }];

test("flags which planted files were touched vs left untouched", () => {
  const d = seedDiffEvidence(seed, ["src/config.ts", "DECISIONS.md"]);
  assert.equal(d.total, 4);
  assert.equal(d.touched, 2);
  assert.deepEqual(d.untouched.sort(), ["README.md", "src/legacy/adapter.ts"]);
  assert.equal(d.files.find((f) => f.path === "src/config.ts")!.touched, true);
  assert.equal(d.files.find((f) => f.path === "src/legacy/adapter.ts")!.touched, false);
});

test("matches paths case-insensitively and ignores a leading ./", () => {
  const d = seedDiffEvidence([{ path: "src/Config.ts" }], ["./SRC/config.ts"]);
  assert.equal(d.touched, 1);
});

test("a submission that touched no planted seam reads as all-untouched", () => {
  const d = seedDiffEvidence(seed, ["unrelated/file.ts"]);
  assert.equal(d.touched, 0);
  assert.equal(d.untouched.length, 4);
});

test("seed files without a path are skipped", () => {
  const d = seedDiffEvidence([{ path: "" }, { path: "a.ts" }], ["a.ts"]);
  assert.equal(d.total, 1);
  assert.equal(d.touched, 1);
});

test("unionChangedPaths dedupes filenames across commits", () => {
  const paths = unionChangedPaths([
    [{ filename: "a.ts" }, { filename: "b.ts" }],
    [{ filename: "a.ts" }, { filename: "./c.ts" }],
    [{}],
  ]);
  assert.deepEqual(paths.sort(), ["a.ts", "b.ts", "c.ts"]);
});
