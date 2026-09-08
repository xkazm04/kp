// The one-call hire door: POST /api/agents/hire-from-need.
//
// Two halves, tested at the level each one lives at:
//   - the machine auth decision, driven directly as a pure function over an
//     injected env (no route, no DB, no next/server);
//   - the route itself against an ISOLATED throwaway DB with the Personas
//     bridge stubbed through `globalThis.fetch` — the same technique
//     agents-bridge.test.ts uses, because there is no module mocking under
//     node:test.
//
// `testing/unit-db.ts` must stay the FIRST project import: it sets an isolated
// KP_DB_PATH before db-path.ts evaluates, and clears KP_OPERATOR_PASSWORD
// (→ open mode) and PERSONAS_BRIDGE_* so no dev-shell pairing leaks in.
import { test, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { cleanupUnitDb } from "../../../_lib/testing/unit-db.ts";
import {
  AUTOMATION_TOKEN_ENV,
  AUTOMATION_TOKEN_HEADER,
  MIN_AUTOMATION_TOKEN_CHARS,
  checkAutomationToken,
  tokensMatch,
} from "./automation-auth.ts";
import { POST as hirePost } from "./route.ts";

after(() => cleanupUnitDb());

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.PERSONAS_BRIDGE_URL;
  delete process.env.PERSONAS_BRIDGE_KEY;
  delete process.env[AUTOMATION_TOKEN_ENV];
  delete process.env.KP_OPERATOR_PASSWORD;
});

/** Build a stand-in `process.env` from just the keys a test cares about.
 *
 *  INVARIANT: `checkAutomationToken` reads exactly one key
 *  (`KP_AUTOMATION_TOKEN`) and never NODE_ENV or anything else, so a partial
 *  record is a complete input for it. The chained cast is the narrow, named
 *  escape from `ProcessEnv`'s required NODE_ENV — asserting it inline at four
 *  call sites would hide that reasoning four times. */
function partialEnv(vars: Record<string, string>): NodeJS.ProcessEnv {
  return vars as unknown as NodeJS.ProcessEnv;
}

/** A token long enough to be accepted as configured. */
const GOOD_TOKEN = "a".repeat(MIN_AUTOMATION_TOKEN_CHARS + 8);

function hireRequest(body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest("http://localhost/api/agents/hire-from-need", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", ...headers },
  });
}

// ---------------------------------------------------------------------------
// The machine door (pure)
// ---------------------------------------------------------------------------

test("the machine door is CLOSED until the operator configures a token", () => {
  const off = checkAutomationToken(GOOD_TOKEN, partialEnv({}));
  assert.equal(off.outcome, "disabled", "an unset env var never defaults open");
  assert.match(
    off.outcome === "disabled" ? off.reason : "",
    new RegExp(AUTOMATION_TOKEN_ENV),
    "the refusal names the variable to set"
  );

  // Blank and whitespace-only are the same as unset: an operator who typed a
  // key with no value did not enable anything.
  assert.equal(checkAutomationToken(GOOD_TOKEN, partialEnv({ [AUTOMATION_TOKEN_ENV]: "   " })).outcome, "disabled");
});

test("a configured token that is too short is refused as configuration, not accepted", () => {
  const weak = checkAutomationToken("abc", partialEnv({ [AUTOMATION_TOKEN_ENV]: "abc" }));
  assert.equal(
    weak.outcome,
    "disabled",
    "a guessable token answers 'not enabled' rather than silently guarding the door"
  );
});

test("a configured token accepts only itself", () => {
  const env = partialEnv({ [AUTOMATION_TOKEN_ENV]: GOOD_TOKEN });
  assert.equal(checkAutomationToken(GOOD_TOKEN, env).outcome, "accepted");
  assert.equal(checkAutomationToken(GOOD_TOKEN + "x", env).outcome, "rejected");
  assert.equal(checkAutomationToken("", env).outcome, "rejected");
  assert.equal(checkAutomationToken(null, env).outcome, "rejected");
  assert.equal(checkAutomationToken(undefined, env).outcome, "rejected");
});

test("the compare is length-independent and never throws on a mismatch", () => {
  // timingSafeEqual throws on unequal-length buffers; hashing both sides first
  // is what makes a one-character guess and a thousand-character guess cost the
  // same and answer false instead of raising.
  assert.equal(tokensMatch("x", GOOD_TOKEN), false);
  assert.equal(tokensMatch("y".repeat(4096), GOOD_TOKEN), false);
  assert.equal(tokensMatch(GOOD_TOKEN, GOOD_TOKEN), true);
});

// ---------------------------------------------------------------------------
// The route
// ---------------------------------------------------------------------------

test("with no token configured and no operator session the route answers 503, not 401", async () => {
  // The distinction matters to a machine caller: "your credential was wrong" is
  // a retry, "no credential would have worked" is an operator action. Open mode
  // is off here because a password is set, so isOperator() is false.
  process.env.KP_OPERATOR_PASSWORD = "shut";
  const res = await hirePost(hireRequest({ need: "n", population: "agent" }));
  assert.equal(res.status, 503);
  const body = (await res.json()) as { code?: string };
  assert.equal(body.code, "HIRE_AUTOMATION_DISABLED");
});

test("a wrong token with no operator session is 401", async () => {
  process.env.KP_OPERATOR_PASSWORD = "shut";
  process.env[AUTOMATION_TOKEN_ENV] = GOOD_TOKEN;
  const res = await hirePost(
    hireRequest({ need: "n", population: "agent" }, { [AUTOMATION_TOKEN_HEADER]: "not-the-token" })
  );
  assert.equal(res.status, 401);
  const body = (await res.json()) as { code?: string };
  assert.equal(body.code, "HIRE_UNAUTHORIZED");
});

test("the body refusals answer before anything is scanned or minted", async () => {
  process.env[AUTOMATION_TOKEN_ENV] = GOOD_TOKEN;
  const h = { [AUTOMATION_TOKEN_HEADER]: GOOD_TOKEN };

  const noNeed = await hirePost(hireRequest({ population: "agent" }, h));
  assert.equal(noNeed.status, 400);
  assert.equal(((await noNeed.json()) as { code?: string }).code, "HIRE_NEED_REQUIRED");

  // `population` is required and must be "agent" — never defaulted, so a caller
  // that meant a human requisition cannot have it turned into an agent by a
  // blank field.
  const noPop = await hirePost(hireRequest({ need: "real need" }, h));
  assert.equal(noPop.status, 400);
  assert.equal(((await noPop.json()) as { code?: string }).code, "HIRE_POPULATION_UNSUPPORTED");

  const human = await hirePost(hireRequest({ need: "real need", population: "human" }, h));
  assert.equal(((await human.json()) as { code?: string }).code, "HIRE_POPULATION_UNSUPPORTED");

  const noProject = await hirePost(hireRequest({ need: "real need", population: "agent" }, h));
  assert.equal(noProject.status, 400);
  assert.equal(((await noProject.json()) as { code?: string }).code, "HIRE_PROJECT_REQUIRED");
});

test("a repository root outside the allow-list is refused by name, before the scan", async () => {
  process.env[AUTOMATION_TOKEN_ENV] = GOOD_TOKEN;
  // KP_APP_MASTER_REPO_ROOTS is unset in the unit env, so NO root is allowed —
  // which is the condition this refusal exists for.
  let bridgeCalls = 0;
  globalThis.fetch = (async () => {
    bridgeCalls += 1;
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch;

  const res = await hirePost(
    hireRequest(
      {
        need: "Nobody owns settlement reconciliation.",
        population: "agent",
        project: { name: "bank-core", rootPath: "C:/definitely/not/allow/listed" },
      },
      { [AUTOMATION_TOKEN_HEADER]: GOOD_TOKEN }
    )
  );
  assert.equal(res.status, 400);
  const body = (await res.json()) as { code?: string; error?: string; allowedRootCount?: number };
  assert.equal(body.code, "HIRE_ROOT_NOT_ALLOWED");
  assert.match(
    body.error ?? "",
    /KP_APP_MASTER_REPO_ROOTS/,
    "the refusal names the env var an operator must set"
  );
  assert.equal(body.allowedRootCount, 0);
  assert.equal(bridgeCalls, 0, "nothing crossed the bridge for a refused root");
});

test("the need is bounded rather than rejected, and the bound is the same one Personas applies", async () => {
  process.env[AUTOMATION_TOKEN_ENV] = GOOD_TOKEN;
  // Driven through the root refusal (the cheapest branch past the need parse):
  // a 5,000-character need must reach it, i.e. must not have been rejected for
  // its length. Rejecting an over-long need would throw away a real request
  // over a formatting fault the caller cannot see.
  const res = await hirePost(
    hireRequest(
      {
        need: "x".repeat(5_000),
        population: "agent",
        project: { name: "p", rootPath: "C:/nope" },
      },
      { [AUTOMATION_TOKEN_HEADER]: GOOD_TOKEN }
    )
  );
  assert.equal(
    ((await res.json()) as { code?: string }).code,
    "HIRE_ROOT_NOT_ALLOWED",
    "an over-long need was bounded and carried forward, not refused"
  );
});
