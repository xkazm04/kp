// The predicate that turns a dev-case session id from a BEARER capability back into a
// plain identifier. Pure (no next/server, no DB), so it runs everywhere the route tests
// can't. The routes' wiring is pinned separately in api/rate-limit-contract.test.ts and
// exercised end-to-end in api/devcase/session/session-intake-guards.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { sessionTokenMatches } from "./devcase-session-auth.ts";

test("the owning apply token authorizes; anything else does not", () => {
  assert.equal(sessionTokenMatches("tok-abc", "tok-abc"), true);
  // Surrounding whitespace from a JSON body is not a mismatch.
  assert.equal(sessionTokenMatches("tok-abc", "  tok-abc  "), true);

  assert.equal(sessionTokenMatches("tok-abc", "tok-abd"), false, "a different posting's link");
  assert.equal(sessionTokenMatches("tok-abc", "tok-ab"), false, "a prefix is not the token");
  assert.equal(sessionTokenMatches("tok-abc", "tok-abcd"), false, "an extension is not the token");
  assert.equal(sessionTokenMatches("tok-abc", "TOK-ABC"), false, "the compare is case-sensitive");
});

test("an absent, empty or non-string presented token never authorizes", () => {
  for (const bad of [undefined, null, "", "   ", 0, 1, true, {}, [], { token: "tok-abc" }]) {
    assert.equal(sessionTokenMatches("tok-abc", bad), false, `presented ${JSON.stringify(bad) ?? "undefined"}`);
  }
});

test("a tokenless session can never be authorized by presenting anything", () => {
  // Rows minted directly (fixtures/dev seeds) carry token: null. The routes skip the
  // check for them (there is no owning link to re-check) — but the predicate itself must
  // never return true, so a falsy stored token can't be matched by a falsy presented one.
  for (const stored of [null, undefined, ""]) {
    assert.equal(sessionTokenMatches(stored, ""), false);
    assert.equal(sessionTokenMatches(stored, "anything"), false);
    assert.equal(sessionTokenMatches(stored, undefined), false);
  }
});

test("unequal lengths are safe (a naive timingSafeEqual on raw buffers throws)", () => {
  assert.doesNotThrow(() => sessionTokenMatches("short", "a-much-longer-apply-token"));
  assert.equal(sessionTokenMatches("short", "a-much-longer-apply-token"), false);
});
