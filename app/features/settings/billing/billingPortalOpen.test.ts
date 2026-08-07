import { test } from "node:test";
import assert from "node:assert/strict";
import { portalOutcome } from "./billingPortalOpen.ts";

// bug-ui-scan-2026-07-09 (plans-checkout-billing-ui #3): a popup-blocked "Manage
// subscription" click used to fail silently. The component now pre-opens the tab
// synchronously; portalOutcome decides what to do with the settled response so the
// customer is NEVER left with a dead click.

test("success + pre-opened tab → navigate that tab to the portal", () => {
  assert.deepEqual(
    portalOutcome({ status: 200, ok: true, url: "https://portal.example/s" }, true),
    { kind: "navigate", url: "https://portal.example/s" },
  );
});

test("success but the pre-open was BLOCKED → fallback link (never a silent dead-end)", () => {
  // The exact bug: before, a blocked open returned with no feedback. Now the caller
  // surfaces a clickable link so the portal is still reachable.
  assert.deepEqual(
    portalOutcome({ status: 200, ok: true, url: "https://portal.example/s" }, false),
    { kind: "fallback", url: "https://portal.example/s" },
  );
});

test("404 → calm 'no customer yet' hint, and it wins over the error branch", () => {
  // A 404 also has ok:false; the hint branch must be checked first.
  assert.deepEqual(portalOutcome({ status: 404, ok: false, code: "BILLING_PORTAL_FAILED" }, true), {
    kind: "hint",
  });
});

test("non-404 failure → error, carrying the machine CODE (never the English message)", () => {
  assert.deepEqual(portalOutcome({ status: 502, ok: false, code: "BILLING_PORTAL_FAILED" }, true), {
    kind: "error",
    code: "BILLING_PORTAL_FAILED",
  });
  assert.deepEqual(portalOutcome({ status: 503, ok: false }, true), { kind: "error", code: null });
});

test("ok:true but no url (malformed provider response) → error, not a broken navigate", () => {
  assert.deepEqual(portalOutcome({ status: 200, ok: true }, true), { kind: "error", code: null });
});
