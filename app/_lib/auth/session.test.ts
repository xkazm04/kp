import { test } from "node:test";
import assert from "node:assert/strict";
import { signSession, verifySession, currentWorkspaceId, DEFAULT_WORKSPACE, SESSION_TTL_MS } from "./session.ts";

process.env.KP_SECRET = process.env.KP_SECRET || "test-master-secret";

test("sign then verify round-trips with the default workspace", () => {
  const now = 1_000_000;
  const tok = signSession(undefined, now);
  const p = verifySession(tok, now);
  assert.ok(p);
  assert.equal(p!.workspace, DEFAULT_WORKSPACE);
  assert.equal(p!.iat, now);
  assert.equal(p!.exp, now + SESSION_TTL_MS);
});

test("a tampered payload fails verification", () => {
  const tok = signSession();
  const [, sig] = tok.split(".");
  const forged = Buffer.from(JSON.stringify({ workspace: "evil", iat: 0, exp: Date.now() + 1e9 }), "utf8").toString("base64url");
  assert.equal(verifySession(`${forged}.${sig}`), null);
});

test("a tampered signature fails verification", () => {
  const tok = signSession();
  const body = tok.split(".")[0];
  assert.equal(verifySession(`${body}.deadbeef`), null);
});

test("an expired token fails", () => {
  const now = 1_000_000;
  const tok = signSession(undefined, now);
  assert.equal(verifySession(tok, now + SESSION_TTL_MS + 1), null);
});

test("a token signed under a different secret fails", () => {
  const tok = signSession();
  const prev = process.env.KP_SECRET;
  process.env.KP_SECRET = "rotated";
  try {
    assert.equal(verifySession(tok), null);
  } finally {
    process.env.KP_SECRET = prev;
  }
});

test("garbage / empty tokens fail closed", () => {
  for (const t of [undefined, null, "", "nodot", "a.b.c.d", "."]) {
    assert.equal(verifySession(t as string | null | undefined), null);
  }
});

test("currentWorkspaceId falls back to the default for a null session", () => {
  assert.equal(currentWorkspaceId(null), DEFAULT_WORKSPACE);
  assert.equal(currentWorkspaceId({ workspace: "w2", iat: 0, exp: 0 }), "w2");
});
