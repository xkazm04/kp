// Executing coverage for the inline-write failure fold, plus the source-level half
// that the fold is actually WIRED into the goal editor.
//
// The defect: `AnalyticsTargetInput` answered every failed save with `throw new
// Error()`. Same border, same tooltip, no sentence — for a refusal (your seat may
// not change this team's goals) and for an outage alike, on the surface that sets
// the goal lines the whole tab judges against.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { localizedSaveFailure } from "./analyticsSaveFailure";
import { LocalizedFailure, localizedFailureMessage } from "./analyticsFetchError";

const HERE = path.join(process.cwd(), "app", "features", "insights", "analytics");
const read = (...p: string[]) => readFileSync(path.join(HERE, ...p), "utf8").replace(/\r\n/g, "\n");

/** A stand-in for the bound `useErrorMessage()` resolver: a tiny "catalog" plus the
 *  same prefer-the-code / fall-back-to-the-caller rule the hook implements. */
const CATALOG: Record<string, string> = {
  ANALYTICS_POLICY_FORBIDDEN: "Vaše role nemůže měnit nastavení analytiky.",
  ANALYTICS_TARGET_SAVE_FAILED: "Cíl se nepodařilo uložit.",
};
const resolve = ((payload, fallback) => {
  const code = payload?.code;
  return code && CATALOG[code] ? CATALOG[code] : fallback;
}) as Parameters<typeof localizedSaveFailure>[1];

const failing = (body: unknown, ok = false): Response =>
  ({ ok, json: async () => body }) as unknown as Response;

test("a refusal resolves to its code's message, never to the server's English string", async () => {
  const failure = await localizedSaveFailure(
    failing({ error: "Your role can't change this team's analytics settings.", code: "ANALYTICS_POLICY_FORBIDDEN" }),
    resolve,
    "fallback"
  );
  assert.ok(failure instanceof LocalizedFailure, "the input renders the message verbatim, so it must be marked localized");
  assert.equal(failure.message, CATALOG.ANALYTICS_POLICY_FORBIDDEN);
});

test("a store failure and a refusal are DIFFERENT sentences", async () => {
  const store = await localizedSaveFailure(failing({ code: "ANALYTICS_TARGET_SAVE_FAILED" }), resolve, "fallback");
  const refused = await localizedSaveFailure(failing({ code: "ANALYTICS_POLICY_FORBIDDEN" }), resolve, "fallback");
  assert.notEqual(store.message, refused.message, "one flat sentence for both is the defect this fold exists to end");
});

test("an unknown code and a body-less failure both fall back to the caller's localized title", async () => {
  const unknown = await localizedSaveFailure(failing({ code: "SOMETHING_NEW" }), resolve, "Couldn't save.");
  assert.equal(unknown.message, "Couldn't save.");
  const bodyless = await localizedSaveFailure(
    {
      ok: false,
      json: async () => {
        throw new SyntaxError("Unexpected end of JSON input");
      },
    } as unknown as Response,
    resolve,
    "Couldn't save."
  );
  assert.equal(bodyless.message, "Couldn't save.", "a proxy 502 carries no code — the localized fallback is the honest answer");
});

test("the failure survives the input's own unwrap", async () => {
  const failure = await localizedSaveFailure(failing({ code: "ANALYTICS_POLICY_FORBIDDEN" }), resolve, "fallback");
  assert.equal(localizedFailureMessage(failure, "fallback"), CATALOG.ANALYTICS_POLICY_FORBIDDEN);
  assert.equal(
    localizedFailureMessage(new Error("SQLITE_BUSY: database is locked at C:/…/kp.sqlite"), "fallback"),
    "fallback",
    "an unlocalized accident must never reach a reader"
  );
});

test("the goal editor uses the fold instead of a bare Error", () => {
  const input = read("AnalyticsTargetInput.tsx");
  assert.doesNotMatch(input, /throw new Error\(\)/, "a bare Error carries nothing a reader can be told");
  assert.match(input, /useErrorMessage\(\)/, "the code is resolved in the reader's language");
  assert.match(input, /localizedSaveFailure\(/, "…through the shared fold, not a second copy of the rule");
  assert.match(input, /announceFailure/, "a lost goal is announced, not only painted (the tooltip is keyboard-unreachable)");
});
