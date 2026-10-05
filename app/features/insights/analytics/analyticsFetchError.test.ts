// The export buttons' failure path: a CODE resolved in the reader's language, or the
// caller's own localized fallback — never a raw status and never the server's English.
//
// Runner: npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { apiErrorPayload, LocalizedFailure, localizedFailureMessage } from "./analyticsFetchError.ts";
import { resolveErrorMessage } from "@/app/_lib/use-error-message";

const FALLBACK = "Export selhal."; // already localized by the caller

test("a localized failure is rendered; anything else falls back", () => {
  assert.equal(localizedFailureMessage(new LocalizedFailure("Příliš mnoho požadavků."), FALLBACK), "Příliš mnoho požadavků.");
  // The exact shape the two call sites used to throw. Painting `.message` here is
  // what shipped "500" and English server prose to every locale.
  assert.equal(localizedFailureMessage(new Error("500"), FALLBACK), FALLBACK);
  assert.equal(localizedFailureMessage(new Error("Could not load the decision log."), FALLBACK), FALLBACK);
  assert.equal(localizedFailureMessage(new TypeError("Failed to fetch"), FALLBACK), FALLBACK, "a network drop is not a server message");
  assert.equal(localizedFailureMessage(undefined, FALLBACK), FALLBACK);
  // An empty LocalizedFailure is not a message either — the fallback still wins.
  assert.equal(localizedFailureMessage(new LocalizedFailure(""), FALLBACK), FALLBACK);
});

test("the body's code is what reaches the resolver", async () => {
  const res = new Response(JSON.stringify({ error: "Too many requests.", code: "TOO_MANY_REQUESTS" }), { status: 429 });
  const payload = await apiErrorPayload(res);
  assert.equal(payload.code, "TOO_MANY_REQUESTS");
  // Folded the way the components fold it: the CODE resolves, the English `error`
  // beside it is never read.
  assert.equal(
    resolveErrorMessage(payload, FALLBACK, (c) => c === "TOO_MANY_REQUESTS", () => "Příliš mnoho požadavků."),
    "Příliš mnoho požadavků."
  );
  // Two distinct failures of the SAME route stay distinguishable — the whole point.
  assert.notEqual(
    resolveErrorMessage({ code: "DECISION_LOG_LOAD_FAILED" }, FALLBACK, () => true, (c) => `msg:${c}`),
    resolveErrorMessage({ code: "TOO_MANY_REQUESTS" }, FALLBACK, () => true, (c) => `msg:${c}`)
  );
});

test("a body-less or unparseable failure is an empty payload, not a second error", async () => {
  assert.deepEqual(await apiErrorPayload(new Response("<html>502</html>", { status: 502 })), {});
  assert.deepEqual(await apiErrorPayload(new Response(null, { status: 500 })), {});
  // …and an empty payload resolves to the caller's localized fallback.
  assert.equal(resolveErrorMessage({}, FALLBACK, () => true, () => "never"), FALLBACK);
});

test("an unknown code falls back rather than printing the code at the reader", async () => {
  const payload = await apiErrorPayload(new Response(JSON.stringify({ error: "Boom", code: "NOT_IN_ANY_CATALOG" }), { status: 500 }));
  assert.equal(resolveErrorMessage(payload, FALLBACK, () => false, () => "never"), FALLBACK);
});

// A SOURCE guard, for the same reason analyticsWindowScope.test.ts uses one: these
// are .tsx components importing through the "@/…" alias, which Node's test runner
// does not resolve, and the invariant is about what the code THROWS — not about a
// value any pure function returns. Comment-stripped, so the prose explaining the
// rule cannot satisfy the assertion that checks it.
function source(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/.*$/gm, "$1");
}

// The decision log's fetch-and-throw half moved out of sections/DecisionLogTable.tsx
// and into useDecisionLogExport.ts when the Decisions tab started offering the same
// file from its own header: the guard follows the code, and now covers BOTH
// surfaces at once because they share the hook. The invariant is unchanged.
test("neither export path throws a raw status or a server string", () => {
  for (const rel of ["./AnalyticsDecisionRecordsPanel.tsx", "./useDecisionLogExport.ts"]) {
    const src = source(rel);
    assert.doesNotMatch(src, /throw new Error\(/, `${rel} still throws a bare Error — resolve the code and throw a LocalizedFailure`);
    assert.match(src, /new LocalizedFailure\(errMsg\(/, `${rel} must resolve the server's code before throwing`);
    assert.match(src, /apiErrorPayload\(res\)/, `${rel} must read the failed response's body for its code`);
  }
  // …and the two renderers unwrap it rather than painting a caught Error's message.
  for (const rel of ["./sections/DecisionRecordsTable.tsx", "./useDecisionLogExport.ts"]) {
    const src = source(rel);
    assert.match(src, /localizedFailureMessage\(err,/, `${rel} must unwrap the failure with its own localized fallback`);
    assert.doesNotMatch(src, /\berr\.message\b/, `${rel} must never paint a thrown Error's raw message`);
  }
  // Both surfaces paint the hook's already-localized string and nothing else — a raw
  // message rendered beside it would reintroduce the English leak the shared hook
  // exists to prevent.
  for (const rel of ["./sections/DecisionLogTable.tsx", "../../hiring/decisions/DecisionsExportLog.tsx"]) {
    const src = source(rel);
    assert.match(src, /\{trailError\}/, `${rel} must render the hook's localized failure`);
    assert.doesNotMatch(src, /\berr\.message\b/, `${rel} must never paint a thrown Error's raw message`);
  }
});
