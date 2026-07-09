import { test } from "node:test";
import assert from "node:assert/strict";
import { signSession, verifySession, currentWorkspaceId, isOperatorSession, DEFAULT_WORKSPACE, SESSION_TTL_MS, sessionEpoch } from "./session.ts";

process.env.KP_SECRET = process.env.KP_SECRET || "test-master-secret";

// CRITICAL (2026-07-09 scan, auth-sessions-workspace-tenancy #2): operator privilege was
// inferred from the ABSENCE of a `sub` claim, so any claim-less cookie was a full owner —
// and /api/auth/switch-workspace re-minted without claims. Privilege is now a positive,
// explicit marker; absence of identity must never imply privilege.
test("operator privilege requires the explicit `op` marker, never absent identity", () => {
  const now = 3_000_000;
  const operator = verifySession(signSession(undefined, now, { op: true }), now);
  assert.equal(isOperatorSession(operator), true);

  // A claim-less session (what a careless re-mint produces) is NOT an operator.
  const claimless = verifySession(signSession("workspace", now), now);
  assert.equal(claimless!.sub, undefined);
  assert.equal(isOperatorSession(claimless), false);

  // A real member session is not an operator either.
  const member = verifySession(signSession("workspace", now, { sub: "usr-1", role: "recruiter" }), now);
  assert.equal(isOperatorSession(member), false);

  // `op` is signed, so it cannot be added without KP_SECRET.
  assert.equal(isOperatorSession(null), false);
});

test("a member session that switches workspace keeps its identity", () => {
  // The re-mint must carry `sub` forward; if it does not, resolveCaller() sees a
  // claim-less cookie. Pinned here at the token layer, where the claims are set.
  const now = 4_000_000;
  const reminted = verifySession(signSession("workspace", now, { sub: "usr-7", org: "org-1", role: "recruiter" }), now);
  assert.equal(reminted!.sub, "usr-7");
  assert.equal(isOperatorSession(reminted), false);
});

test("sign then verify round-trips with the default workspace", () => {
  const now = 1_000_000;
  const tok = signSession(undefined, now);
  const p = verifySession(tok, now);
  assert.ok(p);
  assert.equal(p!.workspace, DEFAULT_WORKSPACE);
  assert.equal(p!.iat, now);
  assert.equal(p!.exp, now + SESSION_TTL_MS);
});

test("identity claims (sub/org/role) round-trip and are omitted when absent", () => {
  const now = 2_000_000;
  const p = verifySession(signSession("ws-team-a", now, { sub: "usr-1", org: "org-1", role: "recruiter" }), now);
  assert.equal(p!.workspace, "ws-team-a");
  assert.equal(p!.sub, "usr-1");
  assert.equal(p!.org, "org-1");
  assert.equal(p!.role, "recruiter");
  // A plain (operator/demo) token carries no identity claims.
  const plain = verifySession(signSession(undefined, now), now);
  assert.equal(plain!.sub, undefined);
  assert.equal(plain!.org, undefined);
  assert.equal(plain!.role, undefined);
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

test("bumping KP_SESSION_EPOCH revokes a session minted at a lower epoch", () => {
  const now = 1_000_000;
  const prev = process.env.KP_SESSION_EPOCH;
  try {
    delete process.env.KP_SESSION_EPOCH; // epoch 0
    assert.equal(sessionEpoch(), 0);
    const tok = signSession(undefined, now);
    assert.ok(verifySession(tok, now)); // valid while the epoch is unchanged

    process.env.KP_SESSION_EPOCH = "1"; // operator pulls the kill-switch
    assert.equal(sessionEpoch(), 1);
    assert.equal(verifySession(tok, now), null); // the old session is now dead
    assert.ok(verifySession(signSession(undefined, now), now)); // a fresh one (epoch 1) is fine
  } finally {
    if (prev === undefined) delete process.env.KP_SESSION_EPOCH;
    else process.env.KP_SESSION_EPOCH = prev;
  }
});

test("a non-positive / garbage KP_SESSION_EPOCH is treated as 0", () => {
  const prev = process.env.KP_SESSION_EPOCH;
  try {
    for (const v of ["0", "-3", "nan", ""]) {
      process.env.KP_SESSION_EPOCH = v;
      assert.equal(sessionEpoch(), 0);
    }
  } finally {
    if (prev === undefined) delete process.env.KP_SESSION_EPOCH;
    else process.env.KP_SESSION_EPOCH = prev;
  }
});
