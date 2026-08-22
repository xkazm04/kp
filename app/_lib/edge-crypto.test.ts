// The two cryptographic contracts a local-first install has with its edge. Both are
// implemented TWICE — here and in edge/src/index.ts, which runs on a different
// runtime — so these tests exist to pin the properties each side must hold, not the
// implementation either side happens to use.
//
// What a failure here means, concretely: an install that cannot open what its edge
// stored (candidates lost at the edge, undrainable), or an edge that accepts a
// forged/replayed drain (anyone who captured one envelope can empty the queue).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EDGE_SIGNATURE_SKEW_MS,
  edgeSigningPayload,
  generateEdgeKeypair,
  isSealedBody,
  sealBody,
  signEdgePayload,
  unsealBody,
  verifyEdgeSignature,
} from "./edge-crypto.ts";

const SECRET = "a-shared-secret-of-real-length-0123456789";

test("the signed payload is timestamp-then-body, so a captured body alone is not replayable", () => {
  assert.equal(edgeSigningPayload("123", '{"a":1}'), '123.{"a":1}');
  // Two calls with the same body but different timestamps must not collide —
  // otherwise the freshness window is decorative.
  assert.notEqual(signEdgePayload(SECRET, "1", "x"), signEdgePayload(SECRET, "2", "x"));
});

test("a well-formed, fresh signature verifies", () => {
  const now = Date.now();
  const ts = String(now);
  const body = JSON.stringify({ upto: 42 });
  assert.equal(verifyEdgeSignature(SECRET, ts, body, signEdgePayload(SECRET, ts, body), now), true);
});

test("verification refuses every way it can fail, rather than throwing", () => {
  const now = Date.now();
  const ts = String(now);
  const body = "{}";
  const good = signEdgePayload(SECRET, ts, body);

  assert.equal(verifyEdgeSignature(SECRET, ts, body, null, now), false, "missing signature");
  assert.equal(verifyEdgeSignature(SECRET, null, body, good, now), false, "missing timestamp");
  assert.equal(verifyEdgeSignature(SECRET, "not-a-number", body, good, now), false, "unparseable timestamp");
  assert.equal(verifyEdgeSignature(SECRET, ts, '{"upto":999}', good, now), false, "body tampered");
  assert.equal(verifyEdgeSignature("another-secret", ts, body, good, now), false, "wrong key");
  assert.equal(verifyEdgeSignature(SECRET, ts, body, good.slice(0, -1), now), false, "truncated signature");
  assert.equal(verifyEdgeSignature(SECRET, ts, body, `${good}ff`, now), false, "extended signature");
});

test("the freshness window bounds replay in BOTH directions", () => {
  const now = Date.now();
  const ts = String(now);
  const sig = signEdgePayload(SECRET, ts, "{}");
  // Just inside, both sides of now (a laptop's clock drifts in both directions).
  assert.equal(verifyEdgeSignature(SECRET, ts, "{}", sig, now + EDGE_SIGNATURE_SKEW_MS - 1_000), true);
  assert.equal(verifyEdgeSignature(SECRET, ts, "{}", sig, now - EDGE_SIGNATURE_SKEW_MS + 1_000), true);
  // Just outside: a captured envelope must not still work tomorrow.
  assert.equal(verifyEdgeSignature(SECRET, ts, "{}", sig, now + EDGE_SIGNATURE_SKEW_MS + 1_000), false);
  assert.equal(verifyEdgeSignature(SECRET, ts, "{}", sig, now - EDGE_SIGNATURE_SKEW_MS - 1_000), false);
});

test("a body sealed to the published key round-trips through the private half", async () => {
  const { publicJwk, privateJwk } = await generateEdgeKeypair();
  // A realistic lead: the thing the edge must be able to ACCEPT without being able
  // to READ. Non-ASCII on purpose — the app's leads are Czech as often as English.
  const lead = JSON.stringify({ email: "jana@example.cz", name: "Jana Nováková", note: "Ráda bych se přihlásila" });
  const sealed = await sealBody(publicJwk, lead);
  assert.equal(isSealedBody(sealed), true);
  assert.equal(await unsealBody(privateJwk, sealed), lead);
});

test("the sealed envelope leaks neither the plaintext nor a reusable key", async () => {
  const { publicJwk } = await generateEdgeKeypair();
  const secretish = "jana@example.cz";
  const sealed = await sealBody(publicJwk, JSON.stringify({ email: secretish }));
  const wire = JSON.stringify(sealed);
  assert.ok(!wire.includes(secretish), "the address must not survive into the stored envelope");
  // Two sealings of identical plaintext must differ — a deterministic envelope
  // would let anyone holding the edge's storage match repeat applicants.
  const again = await sealBody(publicJwk, JSON.stringify({ email: secretish }));
  assert.notEqual(sealed.data, again.data, "fresh key + IV per event");
  assert.notEqual(sealed.key, again.key);
});

test("a body sealed to ANOTHER install's key does not open here", async () => {
  const mine = await generateEdgeKeypair();
  const theirs = await generateEdgeKeypair();
  const sealed = await sealBody(theirs.publicJwk, JSON.stringify({ email: "x@example.cz" }));
  await assert.rejects(() => unsealBody(mine.privateJwk, sealed), "a wrong-key open must throw, never return garbage");
});

test("isSealedBody accepts only the versioned envelope", () => {
  assert.equal(isSealedBody({ v: 1, key: "k", iv: "i", data: "d" }), true);
  assert.equal(isSealedBody({ v: 2, key: "k", iv: "i", data: "d" }), false, "an unknown version must not be parsed as v1");
  assert.equal(isSealedBody({ key: "k", iv: "i", data: "d" }), false);
  assert.equal(isSealedBody({ v: 1, key: "k", iv: "i" }), false);
  assert.equal(isSealedBody(null), false);
  assert.equal(isSealedBody("sealed"), false);
});
