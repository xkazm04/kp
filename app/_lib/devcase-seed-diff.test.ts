import { test } from "node:test";
import assert from "node:assert/strict";
import { changedPathsFromFiles, seedDiffEvidence, unionChangedPaths } from "./devcase-seed-diff.ts";

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

// --- Live Work Surface path (changedPathsFromFiles) --------------------------
//
// The session path has no commits, so "changed" is a CONTENT diff of the submitted
// tree against the seed. These pin the three cases that decide whether the seed
// engagement strip tells the truth for a live session.

const seedTree = [
  { path: "src/config.ts", contents: "export const TIMEOUT = 30;\n" },
  { path: "src/legacy/adapter.ts", contents: "// TODO\n" },
  { path: "DECISIONS.md", contents: "# Decisions\n" },
];

test("changedPathsFromFiles reports only the files whose contents differ from the seed", () => {
  const changed = changedPathsFromFiles(seedTree, [
    { path: "src/config.ts", contents: "export const TIMEOUT = 5;\n" }, // edited
    { path: "src/legacy/adapter.ts", contents: "// TODO\n" }, // untouched
    { path: "DECISIONS.md", contents: "# Decisions\n\n- picked 5s\n" }, // edited
  ]);
  assert.deepEqual(changed.sort(), ["DECISIONS.md", "src/config.ts"]);
});

test("changedPathsFromFiles counts a file the candidate created as changed", () => {
  const changed = changedPathsFromFiles(seedTree, [{ path: "src/config.test.ts", contents: "it works\n" }]);
  assert.deepEqual(changed, ["src/config.test.ts"]);
});

test("an untouched live-session tree yields NO changed paths, so seed engagement reads 0 rather than everything", () => {
  // The live surface saves the WHOLE tree back, including files never opened — a
  // path-presence check would have scored every candidate 3/3 touched. Content is
  // what distinguishes work from a save.
  const changed = changedPathsFromFiles(seedTree, seedTree);
  assert.deepEqual(changed, []);
  const d = seedDiffEvidence(seedTree, changed);
  assert.equal(d.touched, 0);
  assert.equal(d.total, 3);
});

test("changedPathsFromFiles feeds seedDiffEvidence to give a live session real engagement evidence", () => {
  const changed = changedPathsFromFiles(seedTree, [
    { path: "src/config.ts", contents: "export const TIMEOUT = 5;\n" },
    { path: "src/legacy/adapter.ts", contents: "// TODO\n" },
    { path: "DECISIONS.md", contents: "# Decisions\n\n- picked 5s\n" },
  ]);
  const d = seedDiffEvidence(seedTree, changed);
  assert.equal(d.touched, 2);
  assert.equal(d.total, 3);
  assert.deepEqual(d.untouched, ["src/legacy/adapter.ts"]);
});
