import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalize, decisionContentHash } from "./decision-hash.ts";

test("canonicalize is key-order independent", () => {
  assert.equal(canonicalize({ a: 1, b: 2 }), canonicalize({ b: 2, a: 1 }));
  assert.equal(canonicalize({ x: { p: 1, q: 2 } }), canonicalize({ x: { q: 2, p: 1 } }));
});

test("canonicalize preserves array order (arrays are ordered data)", () => {
  assert.notEqual(canonicalize([1, 2, 3]), canonicalize([3, 2, 1]));
});

test("canonicalize drops undefined fields", () => {
  assert.equal(canonicalize({ a: 1, b: undefined }), canonicalize({ a: 1 }));
});

test("decisionContentHash is deterministic for the same (prev, payload)", () => {
  const p = { kind: "auto_rejected", score: 41 };
  assert.equal(decisionContentHash("abc", p), decisionContentHash("abc", p));
  // and order-independent in the payload
  assert.equal(decisionContentHash("abc", { kind: "auto_rejected", score: 41 }), decisionContentHash("abc", { score: 41, kind: "auto_rejected" }));
});

test("a different prevHash yields a different link (chain binding)", () => {
  const p = { kind: "auto_rejected" };
  assert.notEqual(decisionContentHash("", p), decisionContentHash("deadbeef", p));
});

test("tampering with any payload field breaks the hash", () => {
  const base = { kind: "auto_rejected", candidateRef: "e1", reasonCode: "reject", score: 41 };
  const tampered = { ...base, score: 99 };
  assert.notEqual(decisionContentHash("prev", base), decisionContentHash("prev", tampered));
});

test("output is a 64-char hex sha256 digest", () => {
  const h = decisionContentHash("", { kind: "x" });
  assert.match(h, /^[0-9a-f]{64}$/);
});

test("a chain re-hashes identically (seal then verify reproduces hashes)", () => {
  // Simulate sealing two records, then re-deriving the chain as verifyDecisionChain does.
  const r1 = { kind: "auto_rejected", candidateRef: "e1", createdAt: "2026-06-14T00:00:00.000Z" };
  const r2 = { kind: "auto_rejected", candidateRef: "e2", createdAt: "2026-06-14T00:01:00.000Z" };
  const h1 = decisionContentHash("", r1);
  const h2 = decisionContentHash(h1, r2);
  // verify pass
  assert.equal(decisionContentHash("", r1), h1);
  assert.equal(decisionContentHash(h1, r2), h2);
  // a deleted/reordered middle record (verify with r2 linked to genesis) diverges
  assert.notEqual(decisionContentHash("", r2), h2);
});
