// #2 — the ATS admin surface must enforce AUTHORIZATION (operator), not mere
// authentication. Every handler re-verifies the operator session (requireOperator —
// the exact /api/automation + /api/decisions convention): password set + no operator
// session → 401, so a low-privilege member can neither re-point candidate-PII egress
// nor clear the signing secret. Open mode (no KP_OPERATOR_PASSWORD) stays open for
// local dev. Runs against an isolated throwaway DB (unit-db first project import).
//
// NON-VACUITY: a 401 with body {error:"Unauthorized"} is produced ONLY by
// requireOperator, which the pre-fix routes never imported — they returned
// 200/400/404 for these inputs. Against pre-fix code every `assert.equal(status, 401)`
// below fails (the handler answered 200/400/404 instead).
import { test, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { cleanupUnitDb } from "../../_lib/testing/unit-db.ts";
import { GET as configGet, POST as configPost } from "./config/route.ts";
import { POST as testPost } from "./test/route.ts";
import { GET as candidateGet } from "./candidate/[id]/route.ts";
import { GET as deliveriesGet, POST as deliveriesPost } from "./deliveries/route.ts";

after(() => cleanupUnitDb());
afterEach(() => {
  delete process.env.KP_OPERATOR_PASSWORD;
});

function jsonPost(url: string, body: unknown): NextRequest {
  return new NextRequest(url, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
}
function candidateReq(id: string): Promise<Response> {
  return candidateGet(new NextRequest(`http://localhost/api/ats/candidate/${id}`), { params: Promise.resolve({ id }) });
}

test("gated: every ATS handler refuses a non-operator (password set, no operator session) with 401", async () => {
  // Password set + no session cookie in scope = the non-operator caller (a member's
  // valid session likewise carries no operator marker → the same 401).
  process.env.KP_OPERATOR_PASSWORD = "unit-test-password";

  const attempts: Array<[string, () => Promise<Response>]> = [
    ["GET config", () => configGet()],
    [
      "POST config",
      () => configPost(jsonPost("http://localhost/api/ats/config", { webhookUrl: "https://hooks.example.com/x", events: ["candidate.hired"] })),
    ],
    ["POST test", () => testPost()],
    ["GET candidate", () => candidateReq("pe-any")],
    ["GET deliveries", () => deliveriesGet()],
    ["POST deliveries", () => deliveriesPost()],
  ];
  for (const [name, call] of attempts) {
    const res = await call();
    assert.equal(res.status, 401, `${name} must 401 without an operator session`);
    assert.deepEqual(await res.json(), { error: "Unauthorized" });
  }
});

test("open mode (no operator password): the ATS handlers serve the local operator (never 401)", async () => {
  // Matches proxy.ts semantics: KP_OPERATOR_PASSWORD unset = trusted local dev.
  const configRead = await configGet();
  assert.equal(configRead.status, 200);

  // No webhook configured yet → deliver short-circuits (no network). Proves the gate
  // let the caller through (400, not 401).
  const ping = await testPost();
  assert.notEqual(ping.status, 401);

  const candidate = await candidateReq("pe-nonexistent");
  assert.equal(candidate.status, 404, "a missing entry is 404, not 401 — the gate admitted the operator");

  const deliveriesList = await deliveriesGet();
  assert.equal(deliveriesList.status, 200);

  const retry = await deliveriesPost();
  assert.equal(retry.status, 200);

  const save = await configPost(
    jsonPost("http://localhost/api/ats/config", { webhookUrl: "https://hooks.example.com/x", events: ["candidate.hired"] })
  );
  assert.equal(save.status, 200);
});
