// The deep-dive's TTL cache had no test of its own: every assertion about it ran
// through the route, which meant the three properties that actually protect the
// budget — a key that folds trivial variation, a TTL that expires, a cap that
// evicts — were only ever exercised on the happy path. Each is a cost or a
// correctness property (serving a stale read of a real person's work), so each is
// pinned here directly.
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { githubCacheKey, readGithubCache, writeGithubCache } from "./cache.ts";

// --- key normalization -------------------------------------------------------

test("the key folds username case: Octocat and octocat share one entry", () => {
  assert.equal(githubCacheKey("Octocat", "jd"), githubCacheKey("octocat", "jd"));
  assert.notEqual(githubCacheKey("octocat", "jd"), githubCacheKey("octodog", "jd"));
});

test("the key folds JD case and whitespace, so a re-typed JD is not a fresh ~31-call miss", () => {
  const base = githubCacheKey("octocat", "Senior TypeScript engineer");
  assert.equal(base, githubCacheKey("octocat", "senior   typescript\n\tengineer"));
  assert.equal(base, githubCacheKey("octocat", "  Senior TypeScript engineer  "));
  // Folding must not erase MEANING: a different JD is still a different key, or the
  // cache would serve one candidate's job-fit signals for another role.
  assert.notEqual(base, githubCacheKey("octocat", "Senior Rust engineer"));
});

test("the JD contributes to the key only up to its cap, so a megabyte tail cannot fan out keys", () => {
  const head = "a ".repeat(2500); // 5000 chars > the 4000-char key cap
  assert.equal(
    githubCacheKey("octocat", head + "TAIL-ONE"),
    githubCacheKey("octocat", head + "TAIL-TWO"),
    "beyond the cap the JD no longer differentiates keys",
  );
});

// --- TTL ---------------------------------------------------------------------

test("a hit inside the TTL is served; past the TTL it is dropped, never served stale", () => {
  mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
  try {
    const key = githubCacheKey("ttluser", "");
    writeGithubCache(key, { username: "ttluser" });
    assert.deepEqual(readGithubCache(key), { username: "ttluser" }, "fresh hit");

    mock.timers.tick(14 * 60 * 1000); // still inside the 15-minute TTL
    assert.deepEqual(readGithubCache(key), { username: "ttluser" }, "still fresh at 14 min");

    mock.timers.tick(2 * 60 * 1000); // now past it
    assert.equal(readGithubCache(key), undefined, "expired entries are a MISS, never a stale serve");
    // …and the expired entry is dropped on that read, so a second look is a miss too
    // rather than resurrecting on a clock quirk.
    assert.equal(readGithubCache(key), undefined);
  } finally {
    mock.timers.reset();
  }
});

test("a key that was never written is a miss, not a null hit", () => {
  assert.equal(readGithubCache(githubCacheKey("never-written", "")), undefined);
});

// --- cap eviction ------------------------------------------------------------

test("past the 20-entry cap the OLDEST entry is evicted and the newest survives", () => {
  const keys = Array.from({ length: 25 }, (_, i) => githubCacheKey(`capuser${i}`, "cap-test"));
  keys.forEach((k, i) => writeGithubCache(k, { i }));

  // The map is bounded: writing 25 entries cannot leave 25 entries resident.
  const resident = keys.filter((k) => readGithubCache(k) !== undefined);
  assert.ok(resident.length <= 20, `cap must bind; ${resident.length} entries resident`);
  // Insertion order decides: the last write is always still there, the first is not.
  assert.deepEqual(readGithubCache(keys[24]), { i: 24 }, "the newest write survives");
  assert.equal(readGithubCache(keys[0]), undefined, "the oldest write was evicted");
});
