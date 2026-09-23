// The predicate that turns a dev-case session id from a BEARER capability back into a
// plain identifier. The predicates and the two halves of the door decision are pure (the
// module imports the store, but these cases never open it), so they run everywhere the
// route tests can't. The behavioural half is api/devcase/session/session-key.test.ts; the
// routes' wiring is pinned in api/rate-limit-contract.test.ts and exercised end-to-end in
// api/devcase/session/session-intake-guards.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  sessionTokenMatches,
  SESSION_KEY_HEADER,
  hashSessionKey,
  mintSessionKey,
  sessionDoorLifecycle,
  sessionDoorProof,
  sessionKeyMatches,
} from "./devcase-session-auth.ts";
import { SESSION_KEY_HEADER as CLIENT_SESSION_KEY_HEADER } from "../devcase/apply/[token]/liveWorkSync.ts";

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
  // Rows minted directly (fixtures/dev seeds) carry token: null. The door guard refuses
  // them before any proof is read, and the predicate itself must never return true
  // either, so a falsy stored token can't be matched by a falsy presented one.
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

// ── challenge-r06 devcase-session-api/A: the per-attempt session key ─────────────

test("a minted key is a CSPRNG token of >= 32 chars, never repeated, stored only as its sha256", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 50; i++) {
    const key = mintSessionKey();
    assert.match(key, /^dsk-[A-Za-z0-9_-]{32}$/);
    assert.ok(!seen.has(key));
    seen.add(key);
    assert.equal(hashSessionKey(key), createHash("sha256").update(key).digest("hex"));
    assert.notEqual(hashSessionKey(key), key);
  }
});

test("sessionKeyMatches: only the key hashing to the stored digest proves the attempt", () => {
  const key = mintSessionKey();
  const hash = hashSessionKey(key);
  assert.equal(sessionKeyMatches(hash, key), true);
  assert.equal(sessionKeyMatches(hash, `  ${key}  `), true, "header whitespace is not a mismatch");
  assert.equal(sessionKeyMatches(hash, mintSessionKey()), false, "another attempt's key");
  assert.equal(sessionKeyMatches(hash, hash), false, "presenting the stored hash is not the key");
  assert.equal(sessionKeyMatches(hash, key.slice(0, -1)), false);
  for (const bad of [undefined, null, "", "   ", 0, {}, [key]]) assert.equal(sessionKeyMatches(hash, bad), false);
  for (const stored of [null, undefined, "", "not-hex", hash.slice(1)]) assert.equal(sessionKeyMatches(stored, key), false);
});

test("the door decision: keyed rows need the key, legacy rows the apply token, tokenless rows nothing opens", () => {
  const key = mintSessionKey();
  const keyed = { token: "tok-posting", status: "active", keyHash: hashSessionKey(key) };
  const legacy = { token: "tok-posting", status: "active", keyHash: null };
  const refused = { code: "SESSION_TOKEN_REQUIRED", status: 403 };
  // Keyed: the shared apply link is not authority any more.
  assert.deepEqual(sessionDoorProof(keyed, { key: null, token: "tok-posting" }), refused);
  assert.deepEqual(sessionDoorProof(keyed, { key: mintSessionKey(), token: "tok-posting" }), refused);
  assert.equal(sessionDoorProof(keyed, { key, token: undefined }), null);
  // Legacy (key_hash NULL): exactly today's rule, so an attempt in flight at deploy continues.
  assert.equal(sessionDoorProof(legacy, { key: null, token: "tok-posting" }), null);
  assert.deepEqual(sessionDoorProof(legacy, { key: null, token: undefined }), refused);
  assert.deepEqual(sessionDoorProof(legacy, { key: null, token: "tok-other-posting" }), refused);
  // Lifecycle, in order: unknown 404, sealed 409 (only where the door needs active), tokenless 403.
  assert.deepEqual(sessionDoorLifecycle(null, "active"), { code: "DEVCASE_SESSION_NOT_FOUND", status: 404 });
  assert.deepEqual(sessionDoorLifecycle({ ...keyed, status: "submitted" }, "active"), {
    code: "DEVCASE_SESSION_ALREADY_SUBMITTED",
    status: 409,
  });
  assert.equal(sessionDoorLifecycle({ ...keyed, status: "submitted" }, "any"), null, "a repeated finalize is the idempotent retry");
  assert.deepEqual(sessionDoorLifecycle({ token: null, status: "active", keyHash: null }, "active"), refused);
  assert.deepEqual(sessionDoorProof({ token: null, status: "active", keyHash: hashSessionKey(key) }, { key, token: null }), refused);
});

test("the server and the candidate client name the same key header", () => {
  assert.equal(SESSION_KEY_HEADER, CLIENT_SESSION_KEY_HEADER);
  assert.equal(SESSION_KEY_HEADER, SESSION_KEY_HEADER.toLowerCase(), "Headers.get is case-insensitive, but one spelling");
});
