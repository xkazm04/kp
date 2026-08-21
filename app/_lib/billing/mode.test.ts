// The open-source seam's ENV half (billing/mode.ts): does this deployment sell the
// product at all? Pure env reads, so no DB and no throwaway store — the behavioural
// half lives in app/_lib/billing-selfhost.test.ts (unmetered) and
// app/_lib/billing-gate.test.ts (metered).
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { billingProviderConfigured } from "./mode.ts";

const env = (over: Record<string, string>) => over as unknown as NodeJS.ProcessEnv;

test("a credential means commercial; no credential means somebody's own install", () => {
  assert.equal(billingProviderConfigured(env({})), false);
  assert.equal(billingProviderConfigured(env({ POLAR_ACCESS_TOKEN: "  " })), false, "whitespace is not a token");
  assert.equal(billingProviderConfigured(env({ POLAR_ACCESS_TOKEN: "polar_oat_x" })), true);
});

test("KP_OFFLINE ⇒ NOT a selling deployment, even with a leftover provider token", () => {
  // Air-gapped self-host (docs/architecture/self-hosting.md §7): polarGatewayFromEnv()
  // already returns null and every billing route answers 503, so a stale
  // POLAR_ACCESS_TOKEN in the .env must not flip metering on. Before this, it did:
  // meteringActive() → true → PLANS.free → the operator's SECOND published role was
  // refused with a 402 pointing at a Billing panel that reports itself unconfigured.
  for (const flag of ["1", "true", "yes", "on"]) {
    assert.equal(
      billingProviderConfigured(env({ POLAR_ACCESS_TOKEN: "polar_oat_x", KP_OFFLINE: flag })),
      false,
      `KP_OFFLINE=${flag}`
    );
  }
  // A falsey/absent KP_OFFLINE leaves the commercial answer untouched.
  for (const flag of ["", "0", "false", "off"]) {
    assert.equal(billingProviderConfigured(env({ POLAR_ACCESS_TOKEN: "polar_oat_x", KP_OFFLINE: flag })), true);
  }
});
