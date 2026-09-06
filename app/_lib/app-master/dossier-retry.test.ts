// The dossier POST's refusal ladder. Runner: `npm run test:unit`.
//
// Red-first premise: before this module existed, a 429 from
// app/api/intake/[id]/dossier/route.ts landed in the watcher's `catch` and set
// `scanState = "unreachable"`, and a 409 returned with no state at all and no
// wait, so every tasks tick re-POSTed and paid a Python spawn before the
// compare-and-swap refused it again.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DOSSIER_POST_BASE_DELAY_MS,
  DOSSIER_POST_MAX_ATTEMPTS,
  DOSSIER_POST_MAX_DELAY_MS,
  DOSSIER_THROTTLE_WINDOW_MS,
  dossierBackoffMs,
  planDossierRetry,
  retryAfterMsFrom,
} from "./dossier-retry.ts";

test("a throttled POST says throttled, never unreachable", () => {
  const plan = planDossierRetry({ kind: "throttled", retryAfterMs: 30_000 }, 1);
  assert.equal(plan.state, "throttled");
  assert.notEqual(plan.state, "unreachable");
  assert.equal(plan.retry, true);
  // The limiter's own number wins over the ladder's first rung.
  assert.equal(plan.waitMs, 30_000);
});

test("a throttled POST with no Retry-After waits the limiter's window", () => {
  const plan = planDossierRetry({ kind: "throttled", retryAfterMs: null }, 1);
  assert.equal(plan.state, "throttled");
  assert.equal(plan.waitMs, DOSSIER_THROTTLE_WINDOW_MS);
});

test("a 409 re-reads and backs off instead of re-posting every tick", () => {
  const first = planDossierRetry({ kind: "conflict" }, 1);
  assert.equal(first.state, "rereading");
  assert.equal(first.retry, true);
  // NON-VACUITY: the old behaviour was zero wait. Every rung must be positive
  // and strictly bigger than the one before it.
  assert.equal(first.waitMs, DOSSIER_POST_BASE_DELAY_MS);
  const second = planDossierRetry({ kind: "conflict" }, 2);
  assert.ok(second.waitMs > first.waitMs, "the delay must grow");
  const third = planDossierRetry({ kind: "conflict" }, 3);
  assert.ok(third.waitMs > second.waitMs);
});

test("the ladder is bounded", () => {
  const last = planDossierRetry({ kind: "conflict" }, DOSSIER_POST_MAX_ATTEMPTS);
  assert.equal(last.retry, false, "the client stops asking");
  assert.equal(last.waitMs, 0);
  // …but it still SAYS what happened; a spent ladder is not a silent one.
  assert.equal(last.state, "rereading");
  const spentThrottle = planDossierRetry({ kind: "throttled", retryAfterMs: null }, DOSSIER_POST_MAX_ATTEMPTS + 3);
  assert.equal(spentThrottle.retry, false);
  assert.equal(spentThrottle.state, "throttled");
});

test("an unclassified failure keeps the unreachable line it always had", () => {
  const plan = planDossierRetry({ kind: "unreachable" }, 1);
  assert.equal(plan.state, "unreachable");
  assert.equal(plan.retry, true);
  assert.equal(plan.waitMs, DOSSIER_POST_BASE_DELAY_MS);
});

test("the backoff doubles and is capped", () => {
  assert.equal(dossierBackoffMs(1), DOSSIER_POST_BASE_DELAY_MS);
  assert.equal(dossierBackoffMs(2), DOSSIER_POST_BASE_DELAY_MS * 2);
  assert.equal(dossierBackoffMs(3), DOSSIER_POST_BASE_DELAY_MS * 4);
  assert.equal(dossierBackoffMs(99), DOSSIER_POST_MAX_DELAY_MS);
  // A nonsense attempt counter still yields the first rung, never NaN.
  assert.equal(dossierBackoffMs(0), DOSSIER_POST_BASE_DELAY_MS);
  assert.equal(dossierBackoffMs(-4), DOSSIER_POST_BASE_DELAY_MS);
});

test("Retry-After is read as delta-seconds and nothing else", () => {
  assert.equal(retryAfterMsFrom("30"), 30_000);
  assert.equal(retryAfterMsFrom(" 45 "), 45_000);
  assert.equal(retryAfterMsFrom("0"), 0);
  assert.equal(retryAfterMsFrom(null), null);
  assert.equal(retryAfterMsFrom(undefined), null);
  assert.equal(retryAfterMsFrom(""), null, "an empty header is not zero seconds");
  // An HTTP-date depends on the two clocks agreeing; refuse rather than guess.
  assert.equal(retryAfterMsFrom("Wed, 21 Oct 2026 07:28:00 GMT"), null);
  assert.equal(retryAfterMsFrom("-5"), null);
  // Clamped: a hostile or broken header cannot park the client for a day.
  assert.equal(retryAfterMsFrom("999999"), DOSSIER_THROTTLE_WINDOW_MS);
});
