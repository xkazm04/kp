import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_ORG_NAME, orgNameFallback, readClientOrgName, resolveOrgName } from "./org-settings.ts";
import { fixtureSeedEnabled } from "./db/seed-gate.ts";

// The demo's company (Česká spořitelna, the seeded pilot corpus) is a fallback ONLY
// where those fixtures are seeded. An unseeded owner install (`npm run up`,
// KP_EMPTY=1) used to read an unset org as the bank too, so the JD builder
// prefilled a real bank's name onto the owner's first role.

test("the demo name is the fallback only where fixtures are seeded", () => {
  assert.equal(orgNameFallback(true), DEFAULT_ORG_NAME);
  assert.equal(orgNameFallback(false), "");
  assert.equal(orgNameFallback(fixtureSeedEnabled({})), DEFAULT_ORG_NAME, "the default boot is the seeded demo");
  assert.equal(orgNameFallback(fixtureSeedEnabled({ KP_EMPTY: "1" })), "", "npm run up / dev:empty");
});

test("an unset name resolves to the caller's fallback, which defaults to EMPTY", () => {
  assert.equal(resolveOrgName(null), "");
  assert.equal(resolveOrgName("   "), "");
  assert.equal(resolveOrgName(undefined, DEFAULT_ORG_NAME), DEFAULT_ORG_NAME);
  assert.equal(resolveOrgName("", orgNameFallback(false)), "");
});

test("a stored name always wins over any fallback, sanitized and decoded", () => {
  assert.equal(resolveOrgName("Acme%20Studio", DEFAULT_ORG_NAME), "Acme Studio");
  assert.equal(resolveOrgName("  Acme   s.r.o. "), "Acme s.r.o.");
});

test("on the server (no document) the client reader answers its fallback, empty by default", () => {
  assert.equal(readClientOrgName(), "");
  assert.equal(readClientOrgName(DEFAULT_ORG_NAME), DEFAULT_ORG_NAME);
});
