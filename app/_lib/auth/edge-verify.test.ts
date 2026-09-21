import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
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

test("the edge verifier carries the claims the REVOCATION lookup keys on", async () => {
  // The gate has to be able to name the principal a revocation governs, and the only
  // trustworthy source for that is the signed payload. Before targeted revocation
  // existed this verifier returned workspace+exp only, so the gate could tell a valid
  // cookie from an invalid one but not WHOSE it was — and a revoked cookie could only
  // have died later, at a handler, past the 177 routes that carry no second check.
  const now = 5_000_000;
  const user = await verifySessionEdge(signSession("ws-a", now, { sub: "usr-1", org: "org-1", role: "owner" }), SECRET, now);
  assert.equal(user!.iat, now);
  assert.equal(user!.sub, "usr-1");
  assert.equal(user!.op, undefined);

  const operator = await verifySessionEdge(signSession(undefined, now, { op: true }), SECRET, now);
  assert.equal(operator!.op, true);
  assert.equal(operator!.sub, undefined);

  // A pre-identity cookie carries neither; principalFor() has a defined answer for it.
  const plain = await verifySessionEdge(signSession("ws-a", now), SECRET, now);
  assert.equal(plain!.sub, undefined);
  assert.equal(plain!.op, undefined);
});

test("`op` is read as the exact marker, never as a truthy value", async () => {
  // `op` is the PRIVILEGE marker, and it selects the operator's revocation principal.
  // A hand-rolled payload whose `op` is a truthy non-`true` value (a legacy or
  // mistakenly re-minted token) must not be read as the operator here while
  // isOperatorSession() — which tests `=== true` — reads it as a member: that
  // disagreement would point the two layers at different revocation lists.
  const now = 6_000_000;
  const body = Buffer.from(
    JSON.stringify({ workspace: "workspace", iat: now, exp: now + 1000, epoch: 0, op: "yes" }),
    "utf8",
  ).toString("base64url");
  const sig = createHmac("sha256", SECRET).update(body).digest("base64url");
  const s = await verifySessionEdge(`${body}.${sig}`, SECRET, now);
  assert.ok(s, "the token is validly signed — this is about how its claims are READ");
  assert.equal(s!.op, undefined);
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
