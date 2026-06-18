import { test } from "node:test";
import assert from "node:assert/strict";
import { signSession, DEFAULT_WORKSPACE } from "./session.ts";
import { verifySessionEdge } from "./edge-verify.ts";

// crypto.subtle / atob / btoa exist in the Node test runtime, so the Edge verifier
// is exercised here — the critical assertion is node-SIGN ↔ edge-VERIFY interop.
const SECRET = "test-master-secret";
process.env.KP_SECRET = process.env.KP_SECRET || SECRET;

test("a node-signed session verifies under the Edge verifier (interop)", async () => {
  const now = 2_000_000;
  const tok = signSession(undefined, now);
  const p = await verifySessionEdge(tok, SECRET, now);
  assert.ok(p);
  assert.equal(p!.workspace, DEFAULT_WORKSPACE);
});

test("wrong secret fails at the edge", async () => {
  const tok = signSession();
  assert.equal(await verifySessionEdge(tok, "other-secret"), null);
});

test("tampered signature fails at the edge", async () => {
  const tok = signSession();
  const body = tok.split(".")[0];
  assert.equal(await verifySessionEdge(`${body}.AAAA`, SECRET), null);
});

test("expired token fails at the edge", async () => {
  const now = 2_000_000;
  const tok = signSession(undefined, now);
  // far past expiry
  assert.equal(await verifySessionEdge(tok, SECRET, now + 1000 * 60 * 60 * 24 * 999), null);
});

test("missing token / secret fail closed", async () => {
  assert.equal(await verifySessionEdge(undefined, SECRET), null);
  assert.equal(await verifySessionEdge("a.b", undefined), null);
});

test("a session below the current epoch is revoked at the edge (kill-switch)", async () => {
  const now = 2_000_000;
  const prev = process.env.KP_SESSION_EPOCH;
  try {
    delete process.env.KP_SESSION_EPOCH; // token minted at epoch 0
    const tok = signSession(undefined, now);
    assert.ok(await verifySessionEdge(tok, SECRET, now, 0)); // valid while epoch 0
    assert.equal(await verifySessionEdge(tok, SECRET, now, 1), null); // bumped → dead
  } finally {
    if (prev === undefined) delete process.env.KP_SESSION_EPOCH;
    else process.env.KP_SESSION_EPOCH = prev;
  }
});
