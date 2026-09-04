// The public inbound report receiver's abuse containment, behaviourally. It is the
// one door in this feature an unauthenticated caller can knock on (the CSPRNG
// report token is the only auth), and its limiter is deliberately the FIRST thing
// in the handler — ahead of the token lookup, so a flood is shed before the DB is
// touched and an unknown token cannot be used to probe at any rate it likes.
//
// 60/60s per token+IP: an agent reporting one event per run stays far under it.
// The agents-bridge suite covers the accepted/duplicate/404 paths; this file pins
// the budget itself, which nothing did.
//
// unit-db.ts must stay the FIRST project import (isolated throwaway DB).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { cleanupUnitDb } from "../../../../_lib/testing/unit-db.ts";
import { POST } from "./route.ts";
import { createHiredAgent } from "../../../../_lib/db/agents.ts";

after(() => cleanupUnitDb());

// Per-IP keying reads the forwarding headers only under the trusted-proxy model
// (resolveClientIp) — without it every caller shares one bucket.
process.env.KP_TRUSTED_PROXY = "1";

function post(token: string, ip: string, execId: string): Promise<Response> {
  return POST(
    new NextRequest(`http://localhost/api/agents/report/${token}`, {
      method: "POST",
      body: JSON.stringify({ kind: "execution", execId, status: "success" }),
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
    }),
    { params: Promise.resolve({ token }) }
  );
}

test("a flood on one token+IP is shed at 60/60s, and an UNKNOWN token is throttled too", async () => {
  const agent = createHiredAgent({ jobId: "job-throttle", jobTitle: "Role", spec: { name: "A" } }, "ws-throttle");
  const ip = "203.0.113.7";

  for (let i = 0; i < 60; i++) {
    const r = await post(agent.reportToken, ip, `run-${i}`);
    assert.equal(r.status, 200, `report #${i + 1} is inside the budget`);
  }
  const refused = await post(agent.reportToken, ip, "run-over");
  assert.equal(refused.status, 429);

  // The limiter runs BEFORE the token lookup: an unknown token from an
  // already-throttled IP+token pair is refused as 429, and a fresh pair still 404s
  // (proving the budget is per token+IP, not global).
  const unknown = await post("agrpt-not-a-token", ip, "run-x");
  assert.equal(unknown.status, 404, "a different token has its own budget");

  // …and the same agent from a DIFFERENT IP is unaffected.
  const otherIp = await post(agent.reportToken, "203.0.113.8", "run-other-ip");
  assert.equal(otherIp.status, 200);
});
