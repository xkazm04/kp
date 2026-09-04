// `parseRepoRef` is a SECURITY guard, and nothing pinned it.
//
// The function turns a candidate-supplied repository reference into the { owner, repo }
// pair that is interpolated into `https://api.github.com/repos/<owner>/<repo>/...` for a
// fetch that carries GITHUB_TOKEN when one is configured. Its owner/repo grammar checks
// are documented in the source as the fix for a confused-deputy: a crafted ref such as
// `x/..` or `x/%2e%2e` survives URL normalization inside `fetch` and redirects that
// token-authenticated call to a DIFFERENT api.github.com endpoint.
//
// A comment in one other test was the only mention of that guard anywhere in the suite,
// so loosening the two regexes — or dropping them for a "simpler" split on "/" — was a
// green change. This file is the pin: the refusals FIRST, then the shapes that must keep
// resolving so the guard cannot be "fixed" by refusing everything.
//
// Pure + import-free, like the module it tests. Runner: npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRepoRef } from "./repo-snapshot.ts";

test("traversal segments are unresolvable, in every shape they arrive in", () => {
  for (const ref of [
    "octocat/..",
    "octocat/.",
    "https://github.com/octocat/..",
    "https://github.com/octocat/../../users/victim",
    "../octocat/hello",
    "octocat/../hello",
  ]) {
    assert.equal(parseRepoRef(ref), null, `${ref} must not resolve to an owner/repo pair`);
  }
});

test("percent-encoded traversal and separators are refused, not decoded", () => {
  // The danger is not what THIS function does with them — it is that `fetch` normalizes
  // the URL after interpolation, so a repo of `%2e%2e` becomes `..` one layer down.
  for (const ref of [
    "octocat/%2e%2e",
    "octocat/%2E%2E",
    "octocat/hello%2fworld",
    "%2e%2e/hello",
    "octocat/hello%00",
  ]) {
    assert.equal(parseRepoRef(ref), null, `${ref} must not resolve`);
  }
});

test("an over-long owner or repo is refused (GitHub's own name grammar)", () => {
  assert.equal(parseRepoRef(`${"a".repeat(40)}/hello`), null, "owner is capped at 39 characters");
  assert.equal(parseRepoRef(`octocat/${"b".repeat(101)}`), null, "repo is capped at 100 characters");
  // …and the boundary itself still resolves, so the cap is a cap and not an off-by-one.
  assert.deepEqual(parseRepoRef(`${"a".repeat(39)}/hello`), { owner: "a".repeat(39), repo: "hello" });
  assert.deepEqual(parseRepoRef(`octocat/${"b".repeat(100)}`), { owner: "octocat", repo: "b".repeat(100) });
});

test("characters outside the name grammar are refused", () => {
  for (const ref of [
    "octo cat/hello",
    "octo_cat/hello", // underscore is legal in a REPO name, never in an owner
    "octocat/hello world",
    "octocat/hel:lo",
    "octocat/hel$lo",
    "",
    "octocat",
    "/hello",
    "octocat/",
  ]) {
    assert.equal(parseRepoRef(ref), null, `${ref} must not resolve`);
  }
});

// NON-VACUITY: the guard is a guard, not a wall. Every shape the studio's codebase
// field actually accepts must keep resolving.
test("the real-world shapes still resolve", () => {
  const expected = { owner: "octo-cat", repo: "hello_world.js" };
  for (const ref of [
    "octo-cat/hello_world.js",
    "https://github.com/octo-cat/hello_world.js",
    "https://github.com/octo-cat/hello_world.js.git",
    "https://github.com/octo-cat/hello_world.js/tree/main",
    "https://github.com/octo-cat/hello_world.js#readme",
    "git@github.com:octo-cat/hello_world.js.git",
    "HTTPS://GitHub.com/octo-cat/hello_world.js",
  ]) {
    assert.deepEqual(parseRepoRef(ref), expected, `${ref} must resolve`);
  }
});
