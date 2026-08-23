import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  REPO_ROOTS_ENV,
  allowedRoots,
  hasTraversalSegment,
  isInsideRoot,
  resolveRepoUrl,
  resolveRootPath,
  resolveScanTarget,
} from "./repo-scan-target.ts";

// The App-master scan's trust boundary (P2). A server that will read any local path
// you name and hand the contents back is a filesystem oracle, so the local-path door
// is FAIL-CLOSED and every way of getting through it sideways is pinned here:
// the env var unset, a path outside the declared roots, a `..` traversal, a sibling
// directory whose name merely starts with a root's name, and a symlink pointing out.
//
// These tests use REAL directories and REAL symlinks rather than mocking `fs`,
// because the property under test is exactly what the filesystem does — a mocked
// realpath would happily "prove" a guard that does not resolve symlinks at all.

// A bare object, not process.env: the gate must be drivable from an explicit env so
// a test can prove the UNSET case without mutating the real process (which would
// leak across the isolation boundary and make the fail-closed test order-dependent).
function env(value?: string): NodeJS.ProcessEnv {
  return (value === undefined ? {} : { [REPO_ROOTS_ENV]: value }) as NodeJS.ProcessEnv;
}

/** A temp tree: <base>/allowed/{repo,repo-evil}, <base>/outside/secret. */
function makeTree(): { base: string; allowed: string; repo: string; outside: string } {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "kp-scan-gate-")));
  const allowed = path.join(base, "allowed");
  const repo = path.join(allowed, "repo");
  const outside = path.join(base, "outside", "secret");
  fs.mkdirSync(repo, { recursive: true });
  fs.mkdirSync(outside, { recursive: true });
  fs.mkdirSync(path.join(base, "allowed-too"), { recursive: true });
  return { base, allowed, repo, outside };
}

test("no allow-list configured: a local path is refused with a reason that names the env var", () => {
  const tree = makeTree();
  const result = resolveRootPath(tree.repo, env());
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.status, 400);
  assert.match(
    result.ok === false ? result.reason : "",
    new RegExp(REPO_ROOTS_ENV),
    "the refusal must tell the operator which switch turns this on — a bare 403 is unactionable"
  );
  fs.rmSync(tree.base, { recursive: true, force: true });
});

test("an allow-listed path resolves; a path outside every root does not", () => {
  const tree = makeTree();
  const e = env(tree.allowed);

  const inside = resolveRootPath(tree.repo, e);
  assert.equal(inside.ok, true);
  assert.equal(inside.ok === true && inside.target.rootPath, fs.realpathSync(tree.repo));
  assert.equal(inside.ok === true && inside.target.repoUrl, null);

  const outside = resolveRootPath(tree.outside, e);
  assert.equal(outside.ok, false);
  // The refusal must NOT distinguish "does not exist" from "not allowed" — either
  // answer, repeated, maps the filesystem one probe at a time.
  const missing = resolveRootPath(path.join(tree.base, "no-such-dir"), e);
  assert.equal(missing.ok, false);
  assert.equal(
    outside.ok === false ? outside.reason : "x",
    missing.ok === false ? missing.reason : "y",
    "an existing-but-forbidden path and a nonexistent one must give the identical answer"
  );
  fs.rmSync(tree.base, { recursive: true, force: true });
});

test("a '..' segment is refused before it can be resolved away", () => {
  const tree = makeTree();
  const e = env(tree.allowed);
  // Built by concatenation, NOT path.join: join normalizes `..` away, which is
  // precisely the flattening this guard has to see before it happens.
  const traversal = `${tree.repo}${path.sep}..${path.sep}..${path.sep}outside${path.sep}secret`;
  const result = resolveRootPath(traversal, e);
  assert.equal(result.ok, false);
  assert.match(result.ok === false ? result.reason : "", /\.\./, "the operator must be told what was wrong with it");
  // And the property behind it, directly: path.resolve would have flattened this
  // into an innocent-looking absolute path.
  assert.equal(hasTraversalSegment(traversal), true);
  assert.equal(hasTraversalSegment(tree.repo), false);
  fs.rmSync(tree.base, { recursive: true, force: true });
});

test("containment is segment-aware: /base/allowed-too is not inside /base/allowed", () => {
  const tree = makeTree();
  const sibling = path.join(tree.base, "allowed-too");
  assert.equal(isInsideRoot(sibling, tree.allowed), false, "a prefix match is not a containment match");
  assert.equal(isInsideRoot(tree.repo, tree.allowed), true);
  assert.equal(isInsideRoot(tree.allowed, tree.allowed), true, "the root itself is inside itself");

  const result = resolveRootPath(sibling, env(tree.allowed));
  assert.equal(result.ok, false, "the string-prefix sibling must be refused end to end, not just by the helper");
  fs.rmSync(tree.base, { recursive: true, force: true });
});

test("a symlink inside an allowed root that points outside it is refused", (t) => {
  const tree = makeTree();
  const link = path.join(tree.allowed, "escape");
  try {
    fs.symlinkSync(tree.outside, link, "junction");
  } catch {
    // Windows without developer mode / without admin cannot create links at all.
    fs.rmSync(tree.base, { recursive: true, force: true });
    t.skip("this environment cannot create symlinks");
    return;
  }
  const result = resolveRootPath(link, env(tree.allowed));
  assert.equal(
    result.ok,
    false,
    "the guard must compare the symlink's TARGET — a link is not a containment argument"
  );
  fs.rmSync(tree.base, { recursive: true, force: true });
});

test("the allow-list itself is realpath'd, so a symlinked root still contains its real children", (t) => {
  const tree = makeTree();
  const linkedRoot = path.join(tree.base, "allowed-link");
  try {
    fs.symlinkSync(tree.allowed, linkedRoot, "junction");
  } catch {
    fs.rmSync(tree.base, { recursive: true, force: true });
    t.skip("this environment cannot create symlinks");
    return;
  }
  const roots = allowedRoots(env(linkedRoot));
  assert.deepEqual(roots, [fs.realpathSync(tree.allowed)]);
  assert.equal(resolveRootPath(tree.repo, env(linkedRoot)).ok, true);
  fs.rmSync(tree.base, { recursive: true, force: true });
});

test("allowedRoots parses a platform-separated list and drops entries that do not resolve", () => {
  const tree = makeTree();
  const raw = [tree.allowed, "  ", path.join(tree.base, "nope"), tree.base].join(path.delimiter);
  const roots = allowedRoots(env(raw));
  assert.deepEqual(roots, [fs.realpathSync(tree.allowed), fs.realpathSync(tree.base)]);
  fs.rmSync(tree.base, { recursive: true, force: true });
});

test("a file (not a directory) inside an allowed root is refused", () => {
  const tree = makeTree();
  const file = path.join(tree.repo, "README.md");
  fs.writeFileSync(file, "hi");
  assert.equal(resolveRootPath(file, env(tree.allowed)).ok, false);
  fs.rmSync(tree.base, { recursive: true, force: true });
});

test("only https github.com URLs are accepted, and they are normalized", () => {
  const ok = resolveRepoUrl("https://github.com/xkazm04/kp.git?tab=readme");
  assert.equal(ok.ok, true);
  assert.equal(ok.ok === true && ok.target.repoUrl, "https://github.com/xkazm04/kp");
  assert.equal(ok.ok === true && ok.target.rootPath, null);

  for (const bad of [
    "http://github.com/owner/repo", // plaintext
    "https://gitlab.com/owner/repo", // another host
    "https://github.com.evil.test/owner/repo", // host-prefix trick
    "git@github.com:owner/repo.git", // ssh transport, not a URL
    "owner/repo", // the bare shorthand parseRepoRef also accepts
    "https://github.com/owner", // no repo
    "not a url",
    "",
  ]) {
    assert.equal(resolveRepoUrl(bad).ok, false, `${bad || "(empty)"} must be refused`);
  }
});

test("exactly one target shape is accepted", () => {
  const tree = makeTree();
  const both = resolveScanTarget({ repoUrl: "https://github.com/o/r", rootPath: tree.repo }, env(tree.allowed));
  assert.equal(both.ok, false, "two targets can name two different repos — refuse rather than silently pick one");

  const neither = resolveScanTarget({}, env(tree.allowed));
  assert.equal(neither.ok, false);

  const blank = resolveScanTarget({ repoUrl: "   ", rootPath: "" }, env(tree.allowed));
  assert.equal(blank.ok, false, "whitespace is not a target");

  assert.equal(resolveScanTarget({ rootPath: tree.repo }, env(tree.allowed)).ok, true);
  assert.equal(resolveScanTarget({ repoUrl: "https://github.com/o/r" }, env()).ok, true, "a URL scan needs no allow-list");
  fs.rmSync(tree.base, { recursive: true, force: true });
});
