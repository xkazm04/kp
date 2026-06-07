// Locks the server-side candidate-consent policy (idea-98e6cf23). Consent used
// to be a browser-only convention — the Start button stayed disabled until the
// checkbox was ticked, but /connect minted credentials and /complete stored the
// transcript regardless of what the request actually carried. These tests pin
// the decisions documented in interview-consent.ts so the compliance gate can't
// silently regress back into a UI convention:
//
//   - Candidate sessions require explicit `consent === true` to start, and a
//     non-null consent_at to have their transcript persisted.
//   - A truthy-but-not-true consent value (the kind a sloppy client or a partial
//     bypass might send) does NOT satisfy the start gate.
//   - Test/lab sessions are never blocked by either gate.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  consentRequired,
  isConnectConsentSatisfied,
  isPersistConsentSatisfied,
} from "./interview-consent.ts";

// ---------------------------------------------------------------------------
// consentRequired — only real candidates need recorded consent
// ---------------------------------------------------------------------------

test("consentRequired is true for candidate sessions and false for test/lab", () => {
  assert.equal(consentRequired("candidate"), true);
  assert.equal(consentRequired("test"), false);
});

// ---------------------------------------------------------------------------
// isConnectConsentSatisfied — the /connect start gate
// ---------------------------------------------------------------------------

test("a candidate call may start only with explicit consent === true", () => {
  assert.equal(isConnectConsentSatisfied("candidate", true), true);
  assert.equal(isConnectConsentSatisfied("candidate", false), false);
  // The legal basis is a deliberate opt-in: a missing flag is not consent.
  assert.equal(isConnectConsentSatisfied("candidate", undefined), false);
  assert.equal(isConnectConsentSatisfied("candidate", null), false);
});

test("a truthy-but-not-true consent value does NOT start a candidate call", () => {
  // Guards against a client (or a partial bypass) sending "true"/1/{} and having
  // it coerced into consent. Only the literal boolean true counts.
  for (const truthy of ["true", "yes", 1, {}, [], "on"] as unknown[]) {
    assert.equal(
      isConnectConsentSatisfied("candidate", truthy),
      false,
      `truthy value ${JSON.stringify(truthy)} must not satisfy consent`,
    );
  }
});

test("a test/lab call starts regardless of the consent flag", () => {
  assert.equal(isConnectConsentSatisfied("test", true), true);
  assert.equal(isConnectConsentSatisfied("test", false), true);
  assert.equal(isConnectConsentSatisfied("test", undefined), true);
});

// ---------------------------------------------------------------------------
// isPersistConsentSatisfied — the /complete storage invariant
// ---------------------------------------------------------------------------

test("a candidate transcript persists only when consent_at is recorded", () => {
  assert.equal(isPersistConsentSatisfied("candidate", "2026-06-05T10:00:00.000Z"), true);
  assert.equal(isPersistConsentSatisfied("candidate", null), false);
  assert.equal(isPersistConsentSatisfied("candidate", undefined), false);
});

test("a test/lab transcript persists even without a recorded consent_at", () => {
  assert.equal(isPersistConsentSatisfied("test", null), true);
  assert.equal(isPersistConsentSatisfied("test", "2026-06-05T10:00:00.000Z"), true);
});
