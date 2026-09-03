// The Integrations tab's PURE decision rules — the ones that used to live as
// expressions inside components with nothing asserting them.
//
// Two clusters, both flagged by the /perfect 2026-09-03 pass on this context:
//   • the Personas claim poll (integrationsPersonasLogic.ts) — its backoff curve, the
//     branch table of one round, and the superseded-attempt guard. The guard, the
//     timeout branch and the error branch were all untested, which for a two-phase
//     pairing flow means the three ways it can END were the three things nothing pinned.
//   • the webhook panel's `testable` gate (integrationsWebhookGate.ts) — the rule that
//     stops a ping against the PREVIOUS endpoint being reported as proof about the URL
//     currently on screen.
//
// Pure modules only: no DOM, no fetch, no next-intl. Runner: node:test via
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  claimStep,
  CLAIM_POLL_MAX_MS,
  CLAIM_POLL_MS,
  isSupersededAttempt,
  nextClaimDelayMs,
} from "./integrationsPersonasLogic.ts";
import { webhookTestable } from "./integrationsWebhookGate.ts";

test("the claim poll backs off along the stated curve and stops at the cap", () => {
  // The curve the module's own comment claims: 2 → 3 → 4.5 → 6.75 → 10.1 → 15 → 15…
  const seen: number[] = [];
  let d = CLAIM_POLL_MS;
  for (let i = 0; i < 8; i += 1) {
    d = nextClaimDelayMs(d);
    seen.push(d);
  }
  assert.deepEqual(seen, [3000, 4500, 6750, 10125, CLAIM_POLL_MAX_MS, CLAIM_POLL_MAX_MS, CLAIM_POLL_MAX_MS, CLAIM_POLL_MAX_MS]);
  // Monotone, and CAPPED — an unbounded curve would eventually out-wait the 300s TTL
  // and the operator would approve into a poll that never looks again.
  assert.equal(nextClaimDelayMs(CLAIM_POLL_MAX_MS), CLAIM_POLL_MAX_MS);
  assert.ok(CLAIM_POLL_MAX_MS < 300_000);
  // The whole point of backing off: the five-minute wait costs ~25 rounds, not 150.
  let elapsed = 0;
  let rounds = 0;
  let gap = CLAIM_POLL_MS;
  while (elapsed < 300_000) {
    elapsed += gap;
    rounds += 1;
    gap = nextClaimDelayMs(gap);
  }
  assert.ok(rounds < 40, `a full TTL should cost well under 40 rounds, took ${rounds}`);
});

test("one claim round: the deadline wins over every other answer", () => {
  const deadline = 1_000_000;
  // Pre-round check (no response yet).
  assert.equal(claimStep({ nowMs: deadline + 1, deadline }), "timeout");
  assert.equal(claimStep({ nowMs: deadline, deadline }), "retry", "the deadline instant itself is still live");
  // …and AFTER the round, even when the answer says paired: a claim that lands past the
  // Personas-side TTL is not a pairing, and treating it as one would seat a bridge the
  // other machine has already forgotten.
  assert.equal(claimStep({ nowMs: deadline + 1, deadline, response: { ok: true, paired: true } }), "timeout");
  assert.equal(claimStep({ nowMs: deadline + 1, deadline, response: { ok: false, paired: false } }), "timeout");
});

test("one claim round: paired ends it, a server error ends it, everything else retries", () => {
  const deadline = 1_000_000;
  const now = 1;
  assert.equal(claimStep({ nowMs: now, deadline, response: { ok: true, paired: true } }), "paired");
  assert.equal(claimStep({ nowMs: now, deadline, response: { ok: false, paired: false } }), "error");
  // A non-2xx that somehow claims paired is still an ERROR — `ok` is the authority, and
  // a body is not trusted over the status it came with.
  assert.equal(claimStep({ nowMs: now, deadline, response: { ok: false, paired: true } }), "error");
  // The ordinary "not yet" answer, and a transient network failure (nothing fetched).
  assert.equal(claimStep({ nowMs: now, deadline, response: { ok: true, paired: false } }), "retry");
  assert.equal(claimStep({ nowMs: now, deadline, response: null }), "retry");
  assert.equal(claimStep({ nowMs: now, deadline }), "retry");
});

test("a continuation from a superseded attempt is dropped, and only that one", () => {
  // The operator cancels (or restarts) while the start POST is in flight: the counter has
  // moved on, so the in-flight continuation must not re-enter `waiting` or raise a banner.
  assert.equal(isSupersededAttempt(2, 1), true);
  assert.equal(isSupersededAttempt(1, 1), false, "the live attempt must still be allowed to finish");
  // Restarting twice does not resurrect the first attempt.
  assert.equal(isSupersededAttempt(3, 1), true);
});

test("Send test is offered only for a STORED endpoint the field still matches", () => {
  const saved = "https://hooks.example.com/kp";
  assert.equal(webhookTestable(saved, saved), true);
  // Nothing stored: there is nothing to ping.
  assert.equal(webhookTestable("", ""), false);
  assert.equal(webhookTestable("", "https://hooks.example.com/typed"), false);
  // Typed-but-unsaved: this is the case the rule exists for. Pinging here would report
  // the PREVIOUS endpoint's 200 under the address on screen.
  assert.equal(webhookTestable(saved, "https://hooks.example.com/other"), false);
  // A one-character or whitespace difference is a different endpoint.
  assert.equal(webhookTestable(saved, `${saved} `), false);
  assert.equal(webhookTestable(saved, `${saved}/`), false);
  assert.equal(webhookTestable(saved, saved.toUpperCase()), false);
  // Clearing the field (the deliberate "disable delivery" edit) is not testable either —
  // it is an unsaved change like any other.
  assert.equal(webhookTestable(saved, ""), false);
});
